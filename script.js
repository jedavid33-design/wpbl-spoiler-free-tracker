const WPBL_API_BASE = "https://wpbl-api.4d8v7jw78c.workers.dev";

// Two recognizable identity colors per club. One solid marker color is chosen
// for each matchup by the same perceptual-contrast approach used by the Astros
// tracker, then remains fixed for the entire game.
const WPBL_TEAM_COLORS = {
    "boston hunters": { primary: "#004B3D", alternate: "#E8DDC4" },
    "los angeles queens": { primary: "#111111", alternate: "#C99A62" },
    "new york heights": { primary: "#08265C", alternate: "#F4F7FB" },
    "san francisco firebells": { primary: "#4B2A70", alternate: "#F21F32" }
};

const DEFAULT_TEAM_COLORS = { primary: "#64748B", alternate: "#CBD5E1" };

let WPBL_GAMES = [];

async function loadWPBLGames() {
    const response = await fetch(`${WPBL_API_BASE}/games`);
    const data = await response.json();

WPBL_GAMES = (data.games || [])
    .filter(game =>
        game.game_id &&
        game.scheduled_start &&
        game.away_team_name &&
        game.home_team_name
    )
    .map(game => ({
        date: game.scheduled_start.split("T")[0],
        gameId: game.game_id,
        away: game.away_team_name,
        home: game.home_team_name,
        time: game.scheduled_start,
        status: game.status || "",
        completedAt: game.completed_at || "",
        venue: game.venue || game.presto_data?.venue || ""
    }));

    showGamesForDate("today");
}

let selectedGameId = null;

let GAME_DATE = "";
let SAVE_KEY = "";

let events = [];
let revealedIndexes = [];

let awayTeamName = "";
let homeTeamName = "";
let currentGameData = null;
let currentGamePk = null;
let currentGameSchedule = null;
let selectedGameTeamColors = new Map();

function normalizeTeamName(teamName = "") {
    return teamName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getTeamColors(teamName) {
    const normalized = normalizeTeamName(teamName);
    const exact = WPBL_TEAM_COLORS[normalized];
    if (exact) return exact;

    const matchingKey = Object.keys(WPBL_TEAM_COLORS).find(key =>
        normalized.includes(key) || key.includes(normalized)
    );
    return matchingKey ? WPBL_TEAM_COLORS[matchingKey] : DEFAULT_TEAM_COLORS;
}

function hexToRgb(hexColor) {
    const hex = hexColor.replace("#", "");
    return {
        red: parseInt(hex.slice(0, 2), 16) / 255,
        green: parseInt(hex.slice(2, 4), 16) / 255,
        blue: parseInt(hex.slice(4, 6), 16) / 255
    };
}

function relativeLuminance(hexColor) {
    const { red, green, blue } = hexToRgb(hexColor);
    const linearize = channel => channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function rgbToLab(hexColor) {
    const { red, green, blue } = hexToRgb(hexColor);
    const linearize = channel => channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    const r = linearize(red);
    const g = linearize(green);
    const b = linearize(blue);
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const pivot = value => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
    return {
        lightness: 116 * pivot(y) - 16,
        a: 500 * (pivot(x) - pivot(y)),
        b: 200 * (pivot(y) - pivot(z))
    };
}

function perceptualColorDistance(firstColor, secondColor) {
    const first = rgbToLab(firstColor);
    const second = rgbToLab(secondColor);
    return Math.hypot(
        first.lightness - second.lightness,
        first.a - second.a,
        first.b - second.b
    );
}

function getMatchupColorScore(firstColor, secondColor) {
    const firstLuminance = relativeLuminance(firstColor);
    const secondLuminance = relativeLuminance(secondColor);
    let score = perceptualColorDistance(firstColor, secondColor) +
        Math.abs(firstLuminance - secondLuminance) * 45;

    if (firstLuminance < 0.12 && secondLuminance < 0.12) score -= 35;
    if (firstLuminance > 0.82) score -= 28;
    if (secondLuminance > 0.82) score -= 28;
    return score;
}

function selectGameTeamColors(firstTeamName, secondTeamName) {
    const firstIdentity = getTeamColors(firstTeamName);
    const secondIdentity = getTeamColors(secondTeamName);
    const firstCandidates = [firstIdentity.primary, firstIdentity.alternate];
    const secondCandidates = [secondIdentity.primary, secondIdentity.alternate];
    let bestPair = { first: firstCandidates[0], second: secondCandidates[0] };
    let bestScore = -Infinity;

    firstCandidates.forEach(firstColor => {
        secondCandidates.forEach(secondColor => {
            const score = getMatchupColorScore(firstColor, secondColor);
            if (score > bestScore) {
                bestScore = score;
                bestPair = { first: firstColor, second: secondColor };
            }
        });
    });

    return new Map([
        ["away", bestPair.first],
        ["home", bestPair.second]
    ]);
}

function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function showGamesForDate(mode) {
    let date;

    if (mode === "today") {
        date = getLocalDateString();
    } else if (mode === "yesterday") {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        date = getLocalDateString(yesterday);
    } else {
        date = document.getElementById("pickerDate").value;

        if (!date) {
            alert("Pick a date first.");
            return;
        }
    }

    document.getElementById("pickerDate").value = date;
    renderGameChoices(date);
}
function formatGameTime(time) {
    if (!time) return "";

    const gameTime = new Date(time);

    if (isNaN(gameTime)) {
        return time;
    }

    return gameTime.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });
}
function renderGameChoices(date) {
    const container = document.getElementById("gameChoices");

    const games = WPBL_GAMES.filter(game => game.date === date);

    if (games.length === 0) {
        container.innerHTML = `
            <p class="no-games">
                No WPBL games found for this date.
            </p>
        `;
        return;
    }

    container.innerHTML = games.map(game => `
        <button
            class="game-choice"
            onclick="selectGame('${game.gameId}', '${game.date}')"
        >
            <strong>${game.away}</strong>
            <span> at </span>
            <strong>${game.home}</strong>
            <small>${formatGameTime(game.time)}</small>
        </button>
    `).join("");
}

function selectGame(gameId, gameDate) {
    selectedGameId = gameId;
    currentGameSchedule = WPBL_GAMES.find(game => game.gameId === gameId) || null;
    GAME_DATE = gameDate;

    SAVE_KEY = `wpbl-tracker-${gameId}`;

    events = [];
    revealedIndexes = [];
    selectedGameTeamColors = new Map();

    document.getElementById("gamePicker").classList.add("hidden");
    document.getElementById("trackerScreen").classList.remove("hidden");

    loadGame();
}

function returnToGamePicker() {
    selectedGameId = null;
    currentGameData = null;
    currentGamePk = null;
    currentGameSchedule = null;

    document.getElementById("trackerScreen").classList.add("hidden");
    document.getElementById("gamePicker").classList.remove("hidden");
}

    
async function loadGame(askResume = true) {
    if (askResume) {
    document.getElementById("status").innerHTML = "Loading WPBL game...";
    document.getElementById("batterInfo").innerHTML = "";
    document.getElementById("eventList").innerHTML = "";
}

    if (!selectedGameId) {
    return;
}

const gameId = selectedGameId;

const feedUrl =
    `${WPBL_API_BASE}/games/${gameId}/boxscore`;

const feedResponse = await fetch(feedUrl);
const responseData = await feedResponse.json();

const feedData = responseData.boxscore;

currentGameData = feedData;
currentGamePk = gameId;

const awayTeam = feedData.teams.find(team => team.side === "away");
const homeTeam = feedData.teams.find(team => team.side === "home");

awayTeamName = awayTeam?.name || "Away";
homeTeamName = homeTeam?.name || "Home";
selectedGameTeamColors = selectGameTeamColors(awayTeamName, homeTeamName);

buildEvents(feedData)

    const saved = localStorage.getItem(SAVE_KEY);

if (askResume && saved) {
    const resume = confirm("Resume saved progress for this game?");

        if (resume) {
            try {
                const parsed = JSON.parse(saved);

                if (Array.isArray(parsed)) {
                    revealedIndexes = parsed;
                    redrawFeed();
                    return;
                }
            } catch {
                localStorage.removeItem(SAVE_KEY);
            }
        }
    }

    updateStatus();
}
function getRunsScored(play) {
    const narrative = play.narrative || "";

    // WPBL's runs_scored may omit the batter on home runs.
    // For homers, use the RBI total from the narrative.
    const isHomeRun =
        /homered|home run/i.test(narrative);

    if (isHomeRun) {
        // Handles:
        // "RBI"   = 1 run
        // "2 RBI" = 2 runs
        // "3 RBI" = 3 runs
        // "4 RBI" = 4 runs
        const rbiMatch =
            narrative.match(/(?:(\d+)\s+)?RBI\b/i);

        if (rbiMatch) {
            return rbiMatch[1]
                ? Number(rbiMatch[1])
                : 1;
        }

        // Emergency fallback:
        // batter scores on every home run.
        const runnersScored =
            (narrative.match(/\bscored\b/gi) || []).length;

        return runnersScored + 1;
    }

    return Number(play.runs_scored) || 0;
}

const PLATE_APPEARANCE_EVENT_TYPES = new Set([
    "double",
    "fielders_choice",
    "flyout",
    "foul_out",
    "groundout",
    "hit_by_pitch",
    "home_run",
    "lineout",
    "out",
    "popup",
    "sacrifice",
    "single",
    "strikeout",
    "triple",
    "walk"
]);

function isPlateAppearanceComplete(play) {
    const eventType = String(play.event_type || "").toLowerCase();
    if (PLATE_APPEARANCE_EVENT_TYPES.has(eventType)) return true;

    const narrative = String(play.narrative || "");
    return /\b(?:walked|struck out|singled|doubled|tripled|homered|hit by pitch|reached first|reached on|grounded out|flied out|lined out|popped out|fouled out|sacrifice)\b/i.test(narrative);
}

function inferOutsRecorded(play = {}) {
    const eventType = String(play.event_type || "").toLowerCase();
    const narrative = String(play.narrative || "");

    if (/triple[ _-]?play/i.test(eventType) || /\btriple play\b/i.test(narrative)) return 3;
    if (/double[ _-]?play/i.test(eventType) || /\bdouble play\b/i.test(narrative)) return 2;

    const oneOutTypes = new Set([
        "strikeout", "groundout", "flyout", "lineout", "popup",
        "foul_out", "out", "sacrifice"
    ]);
    if (oneOutTypes.has(eventType)) return 1;

    if (/\b(?:struck out|grounded out|flied out|lined out|popped out|fouled out|caught stealing|picked off|out at)\b/i.test(narrative)) {
        return 1;
    }

    return 0;
}

function getPostPlayOuts(play, nextPlay) {
    const startingOuts = Number(play?.outs);
    const safeStartingOuts = Number.isFinite(startingOuts) ? startingOuts : 0;

    // Presto reports the out count at the start of a play. The next play in the
    // same half-inning is the best authoritative post-play snapshot when present.
    if (hasSameHalfInning(play, nextPlay)) {
        const nextOuts = Number(nextPlay?.outs);
        if (Number.isFinite(nextOuts) && nextOuts >= safeStartingOuts) {
            return Math.min(3, nextOuts);
        }
    }

    // If Presto has already advanced to the other half, this play ended the half.
    if (nextPlay && !hasSameHalfInning(play, nextPlay)) {
        return 3;
    }

    // Live edge: the next batter may not exist yet. Infer only from explicit
    // out-producing result text/types, including multi-out plays.
    return Math.min(3, safeStartingOuts + inferOutsRecorded(play));
}

function getPlayStartingBases(play = {}) {
    return {
        first: play.first_base || "",
        second: play.second_base || "",
        third: play.third_base || ""
    };
}

function hasSameHalfInning(firstPlay, secondPlay) {
    return Boolean(secondPlay) &&
        Number(firstPlay.inning) === Number(secondPlay.inning) &&
        String(firstPlay.half || "").toLowerCase() === String(secondPlay.half || "").toLowerCase();
}

function removeRunnerFromBases(bases, runnerName) {
    Object.keys(bases).forEach(base => {
        if (bases[base] === runnerName) bases[base] = "";
    });
}

function setRunnerDestination(bases, runnerName, destination) {
    if (!runnerName) return;
    removeRunnerFromBases(bases, runnerName);
    if (destination && destination !== "home") bases[destination] = runnerName;
}

function deriveFinalBasesFromNarrative(play) {
    const narrative = String(play.narrative || "");
    const bases = { ...getPlayStartingBases(play) };
    if (!narrative) return null;

    const knownNames = new Set([
        play.batter_name,
        bases.first,
        bases.second,
        bases.third
    ].filter(Boolean));
    const escapedNames = [...knownNames]
        .sort((a, b) => b.length - a.length)
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const namePattern = escapedNames.length ? `(${escapedNames.join("|")})` : null;

    if (namePattern) {
        const destinationPattern = new RegExp(`${namePattern} (?:advanced|stole|moved) to (first|second|third)`, "gi");
        let destinationMatch;
        while ((destinationMatch = destinationPattern.exec(narrative))) {
            setRunnerDestination(bases, destinationMatch[1], destinationMatch[2].toLowerCase());
        }

        const removedPattern = new RegExp(`${namePattern} (?:scored|was out|out at|picked off|caught stealing)`, "gi");
        let removedMatch;
        while ((removedMatch = removedPattern.exec(narrative))) {
            removeRunnerFromBases(bases, removedMatch[1]);
        }
    }

    const batter = play.batter_name || "";
    if (/\b(?:homered|home run)\b/i.test(narrative)) {
        Object.keys(bases).forEach(base => { bases[base] = ""; });
    } else if (/\btripled\b/i.test(narrative)) {
        setRunnerDestination(bases, batter, "third");
    } else if (/\bdoubled\b/i.test(narrative)) {
        setRunnerDestination(bases, batter, "second");
    } else if (/\b(?:singled|walked|hit by pitch|reached first|reached on|fielder'?s choice)\b/i.test(narrative)) {
        setRunnerDestination(bases, batter, "first");
    } else if (isPlateAppearanceComplete(play)) {
        removeRunnerFromBases(bases, batter);
    }

    return bases;
}

function getFinalBasesForPlay(play, nextPlay) {
    if (nextPlay && !hasSameHalfInning(play, nextPlay)) {
        return { first: "", second: "", third: "" };
    }

    // WPBL supplies each play's starting snapshot. The next play's snapshot is
    // therefore the authoritative final destination state for this play.
    if (hasSameHalfInning(play, nextPlay)) return getPlayStartingBases(nextPlay);

    // During a live game's newest play there may be no following snapshot yet.
    // Use only destinations stated explicitly in the narrative.
    return deriveFinalBasesFromNarrative(play);
}

function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function findPitchingDecision(teams, decisionKey) {
    for (const team of teams) {
        const player = (team.players || []).find(candidate => candidate.pitching?.[decisionKey]);
        if (player) return player.name;
    }
    return "";
}

function buildGameCompleteEvent(data) {
    const teams = data.teams || [];
    const awayTeam = teams.find(team => team.side === "away");
    const homeTeam = teams.find(team => team.side === "home");
    const teamSummaries = [awayTeam, homeTeam].filter(Boolean).map(team => ({
        name: team.name,
        runs: team.totals?.runs,
        hits: team.totals?.hits,
        errors: team.totals?.errors,
        leftOnBase: team.totals?.left_on_base,
        pitchers: (team.players || [])
            .filter(player => player.pitching?.pitches !== undefined)
            .map(player => ({ name: player.name, pitches: player.pitching.pitches }))
    }));

    return {
        kind: "game-complete",
        inning: "Game Complete",
        text: "Game Complete",
        isPitch: false,
        isResult: false,
        isPlateAppearanceResult: false,
        atBat: Number.MAX_SAFE_INTEGER,
        battingSide: "",
        teamColor: "#64748B",
        bases: { first: "", second: "", third: "" },
        details: {
            scheduledStart: formatDateTime(currentGameSchedule?.time),
            venue: currentGameSchedule?.venue || "",
            winningPitcher: findPitchingDecision(teams, "win"),
            losingPitcher: findPitchingDecision(teams, "loss"),
            savePitcher: findPitchingDecision(teams, "save"),
            teams: teamSummaries
        }
    };
}

function buildEvents(data) {
    events = [];

    const plays = data.plays || [];

    let plateAppearanceNumber = 0;

    plays.forEach((play, playNumber) => {
        const inning = play.inning;
        const half = (play.half || "").toUpperCase();
        const batter = play.batter_name || "";
        const pitcher = play.pitcher_name || "";
        const startingBases = getPlayStartingBases(play);
        const nextPlay = plays[playNumber + 1];
        const finalBases = getFinalBasesForPlay(play, nextPlay);
        const completesPlateAppearance = isPlateAppearanceComplete(play);
        const postPlayOuts = getPostPlayOuts(play, nextPlay);

        // Add individual pitches first
        const pitchEvents = play.pitch_events || [];

        let balls = 0;
        let strikes = 0;

        pitchEvents.forEach((pitch, pitchIndex) => {
            const code = pitch.code;
            let text = pitch.description || `Pitch ${pitchIndex + 1}`;

            // WPBL currently mislabels some codes.
            // K behaves like a strike in the captured feed.
            // P appears to mean ball put in play.
            if (code === "B") {
                balls++;
            } else if (code === "K") {
                strikes++;
                text = "Called strike";
            } else if (code === "F") {
                if (strikes < 2) strikes++;
                text = "Foul";
            } else if (code === "P" && pitch.type === "pitchout") {
                // Presto labels its terminal ball-in-play marker as pitchout.
                // Keep the feed identity intact and correct only the display.
                text = "Ball in play";
            }

            events.push({
                inning: `${half} ${inning}`,
                batter: batter,
                pitcher: pitcher,
                text: text,
                atBat: plateAppearanceNumber,
                balls: balls,
                strikes: strikes,
                outs: play.outs,
                pitchNumber: pitchIndex + 1,
                isPitch: true,
                isResult: false,
                battingSide: half === "TOP" ? "away" : "home",
                teamColor: selectedGameTeamColors.get(half === "TOP" ? "away" : "home"),
                bases: startingBases
            });
        });

        // Add the completed play / plate appearance
        if (play.narrative) {
            events.push({
                inning: `${half} ${inning}`,
                batter: batter,
                pitcher: pitcher,
                text: `RESULT: ${play.narrative}`,
                atBat: plateAppearanceNumber,
                balls: play.balls,
                strikes: play.strikes,
                outs: postPlayOuts,
                pitchNumber: null,

                isPitch: false,
                isResult: completesPlateAppearance,
                isPlateAppearanceResult: completesPlateAppearance,

                eventType: play.event_type,
                rawNarrative: play.narrative,
                playSequence: play.sequence,
                battingSide: half === "TOP" ? "away" : "home",
                teamColor: selectedGameTeamColors.get(half === "TOP" ? "away" : "home"),
                bases: finalBases,

                // We'll calculate spoiler-safe scores from runs scored,
                // rather than exposing the live final/current score.
                runsScored: getRunsScored(play),

                isHit: play.is_hit || false,
                isScoringPlay: play.is_scoring_play || false
            });
        }

        if (completesPlateAppearance) plateAppearanceNumber++;
    });

    if (data.game_status === "Final" || data.status?.complete === true) {
        events.push(buildGameCompleteEvent(data));
    }
}

function saveProgress() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(revealedIndexes));
}

function getCurrentIndex() {
    if (revealedIndexes.length === 0) {
        return -1;
    }

    return revealedIndexes[revealedIndexes.length - 1];
}

function getSpoilerFreeScore() {
    let awayScore = 0;
    let homeScore = 0;

    revealedIndexes.forEach(index => {
        const event = events[index];

        if (!event.runsScored) return;

        if (event.battingSide === "away") {
            awayScore += event.runsScored;
        } else if (event.battingSide === "home") {
            homeScore += event.runsScored;
        }
    });

    return { awayScore, homeScore };
}
function getSpoilerFreeHitsErrors() {
    let awayHits = 0;
    let homeHits = 0;
    let awayErrors = 0;
    let homeErrors = 0;

    const hitTypes = [
        "single",
        "double",
        "triple",
        "home_run"
    ];

    revealedIndexes.forEach(index => {
        const event = events[index];

        if (!event.eventType) return;

        if (hitTypes.includes(event.eventType)) {
            if (event.battingSide === "away") {
                awayHits++;
            } else {
                homeHits++;
            }
        }

        if (
            event.eventType === "field_error" ||
            event.text.toLowerCase().includes("error")
        ) {
            if (event.battingSide === "away") {
                homeErrors++;
            } else {
                awayErrors++;
            }
        }
    });

    return {
        awayHits,
        homeHits,
        awayErrors,
        homeErrors
    };
}
function getPitcherPitchCount(pitcherName) {
    let count = 0;

    revealedIndexes.forEach(index => {
        const event = events[index];

        if (
            event.pitcher === pitcherName &&
            event.pitchNumber
        ) {
            count++;
        }
    });

    return count;
}

function getDisplayState() {
    const currentIndex = getCurrentIndex();
    if (events.length === 0) return null;
    if (currentIndex === -1) return { event: events[0], preview: true };

    const current = events[currentIndex];
    if (current.isPlateAppearanceResult) {
        const nextPlateAppearance = events.slice(currentIndex + 1).find(event =>
            event.kind !== "game-complete" && event.atBat > current.atBat
        );
        if (nextPlateAppearance) {
            return { event: nextPlateAppearance, preview: true, previous: current };
        }
    }

    return { event: current, preview: false, previous: null };
}

function renderBaseDiamond(bases) {
    if (!bases) {
        return '<div class="base-state-unavailable">Base state updating</div>';
    }

    const occupied = key => bases[key] ? " occupied" : "";
    const label = [
        bases.first && `First: ${bases.first}`,
        bases.second && `Second: ${bases.second}`,
        bases.third && `Third: ${bases.third}`
    ].filter(Boolean).join(", ") || "Bases empty";

    return `
        <div class="base-diamond" aria-label="${label}" title="${label}">
            <span class="base second${occupied("second")}"></span>
            <span class="base third${occupied("third")}"></span>
            <span class="base first${occupied("first")}"></span>
            <span class="home-plate"></span>
        </div>
    `;
}

function updateStatus() {
    const currentIndex = getCurrentIndex();
const score = getSpoilerFreeScore();
const totals = getSpoilerFreeHitsErrors();

    const displayState = getDisplayState();
    const activeEvent = displayState?.event;
    const trackerScreen = document.getElementById("trackerScreen");
    trackerScreen.style.setProperty(
        "--active-team-color",
        activeEvent?.teamColor || "#64748B"
    );
    

    
document.getElementById("status").innerHTML = `
    <div class="scoreboard">
        <div class="rhe-header">
            <span></span>
            <span>R</span>
            <span>H</span>
            <span>E</span>
        </div>

<div class="rhe-row">
    <button class="team-link" onclick="showLineup('away')">${awayTeamName}</button>
    <span>${score.awayScore}</span>
    <span>${totals.awayHits}</span>
    <span>${totals.awayErrors}</span>
</div>

<div class="rhe-row">
    <button class="team-link" onclick="showLineup('home')">${homeTeamName}</button>
    <span>${score.homeScore}</span>
    <span>${totals.homeHits}</span>
    <span>${totals.homeErrors}</span>
</div>
    </div>
`;

    if (currentIndex === -1) {
        document.getElementById("batterInfo").innerHTML =
            "Press Next Event to begin.";
        return;
    }

    const event = displayState?.event;
    if (!event) return;

    if (event.kind === "game-complete") {
        document.getElementById("batterInfo").innerHTML = `
            <div class="inning-line">Game Complete</div>
            <div class="completion-message">Every available event has been revealed.</div>
        `;
        return;
    }
    
    const balls = displayState.preview ? 0 : (event.balls ?? 0);
const strikes = displayState.preview ? 0 : (event.strikes ?? 0);
const outs = event.outs ?? 0;

const ballDots =
    "● ".repeat(balls) +
    "○ ".repeat(4 - balls);

const strikeDots =
    "● ".repeat(strikes) +
    "○ ".repeat(3 - strikes);

const outDots =
    "● ".repeat(outs) +
    "○ ".repeat(3 - outs);

document.getElementById("batterInfo").innerHTML = `
    ${displayState.preview && currentIndex >= 0 ? '<div class="next-batter-label">Next Batter</div>' : ''}
    <div class="inning-line">${event.inning}</div>

    <div class="matchup-line">
        <strong>${event.pitcher}</strong>
        <span> vs </span>
        <strong>${event.batter}</strong>
    </div>

    <div class="count-line">
        <span>⚾ <span class="count-dots">${ballDots}</span></span>
<span><strong>K</strong> <span class="count-dots">${strikeDots}</span></span>
<span>❌ <span class="count-dots">${outDots}</span></span>
    </div>

    <div class="between-play-info">
        ${renderBaseDiamond(event.bases)}
    </div>
`;
}

function getEventIcon(event) {
    if (event.kind === "game-complete") return "✓";
    const text = event.text.toLowerCase();

    if (event.pitchNumber) {
        const numbers = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];
        return numbers[event.pitchNumber] || `P${event.pitchNumber}`;
    }

    if (text.includes("steals")) return "🏃";
    if (text.includes("pickoff")) return "⚠️";
    if (text.includes("homers") || text.includes("home run")) return "💥";
    if (text.includes("pitching change")) return "🔁";
    if (text.includes("defensive")) return "🧤";

    return "•";
}

function addEventCard(index) {
    const event = events[index];
    const icon = getEventIcon(event);

    const row = document.createElement("div");

    if (event.kind === "game-complete") {
        row.className = "event-row game-complete-card";
        const details = event.details;
        const optionalDetail = (label, value) => value
            ? `<div><dt>${label}</dt><dd>${value}</dd></div>`
            : "";
        const teamSummaryHtml = details.teams.map(team => {
            const rhe = [team.runs, team.hits, team.errors].every(value => value !== undefined && value !== null)
                ? `${team.runs} R · ${team.hits} H · ${team.errors} E`
                : "";
            const leftOnBase = team.leftOnBase !== undefined && team.leftOnBase !== null
                ? ` · ${team.leftOnBase} LOB`
                : "";
            return `
                <section class="postgame-team">
                    <h4>${team.name}</h4>
                    ${rhe ? `<p>${rhe}${leftOnBase}</p>` : ""}
                </section>
            `;
        }).join("");
        const pitchCountHtml = details.teams.map(team => `
            <section class="pitch-count-team">
                <h4>${team.name}</h4>
                <ul>
                    ${team.pitchers.map(pitcher => `
                        <li><span>${pitcher.name}</span><strong>${pitcher.pitches} pitches</strong></li>
                    `).join("")}
                </ul>
            </section>
        `).join("");

        row.innerHTML = `
            <div class="game-complete-title">
                <span class="event-icon">${icon}</span>
                <span>Game Complete</span>
            </div>
            <div class="postgame-team-grid">${teamSummaryHtml}</div>
            <dl class="game-complete-details">
                ${optionalDetail("Scheduled start", details.scheduledStart)}
                ${optionalDetail("Venue", details.venue)}
                ${optionalDetail("Winning pitcher", details.winningPitcher)}
                ${optionalDetail("Losing pitcher", details.losingPitcher)}
                ${optionalDetail("Save", details.savePitcher)}
                ${pitchCountHtml ? `
                    <div class="wide">
                        <dt>Official pitch counts</dt>
                        <dd class="pitch-counts">${pitchCountHtml}</dd>
                    </div>
                ` : ""}
            </dl>
        `;
        document.getElementById("eventList").prepend(row);
        return;
    }

    row.className = `event-row team-event ${event.isPitch ? "low-emphasis" : "important-event"}`;
    row.style.setProperty("--event-team-color", event.teamColor || "#64748B");

    row.innerHTML = `
        <span class="event-icon">${icon}</span>
        <span class="event-text">${event.text}</span>
    `;

    document.getElementById("eventList").prepend(row);
}

function redrawFeed() {
    document.getElementById("eventList").innerHTML = "";

    revealedIndexes.forEach(index => {
        addEventCard(index);
    });

    updateStatus();
}

function revealIndex(index) {
    revealedIndexes.push(index);
    addEventCard(index);
    saveProgress();
    updateStatus();
}

function revealThrough(targetIndex) {
    const currentIndex = getCurrentIndex();
    const lastIndex = Math.min(targetIndex, events.length - 1);
    if (lastIndex <= currentIndex) {
        updateStatus();
        return;
    }

    for (let index = currentIndex + 1; index <= lastIndex; index++) {
        revealedIndexes.push(index);
        addEventCard(index);
    }
    saveProgress();
    updateStatus();
}

function nextEvent() {
    const currentIndex = getCurrentIndex();
    const nextIndex = currentIndex + 1;

    if (nextIndex < events.length) {
        revealIndex(nextIndex);
    }
}

function previousEvent() {
    if (revealedIndexes.length === 0) {
        return;
    }

    revealedIndexes.pop();

    const list = document.getElementById("eventList");

    if (list.firstChild) {
        list.removeChild(list.firstChild);
    }

    saveProgress();
    updateStatus();
}

function nextAtBat() {
    const currentIndex = getCurrentIndex();
    if (events.length === 0) return;

    let scopeStart = currentIndex === -1 ? 0 : currentIndex;
    if (
        currentIndex >= 0 &&
        events[currentIndex].isPlateAppearanceResult &&
        events[currentIndex + 1]?.kind !== "game-complete"
    ) {
        scopeStart = currentIndex + 1;
    }

    const targetAtBat = events[scopeStart]?.atBat;
    if (targetAtBat === undefined) return;
    let boundaryIndex = scopeStart;
    while (
        boundaryIndex < events.length &&
        events[boundaryIndex].atBat === targetAtBat
    ) {
        boundaryIndex++;
    }
    revealThrough(boundaryIndex - 1);
}

function nextInning() {
    const currentIndex = getCurrentIndex();
    if (events.length === 0) return;

    let scopeStart = currentIndex === -1 ? 0 : currentIndex;
    const upcomingEvent = events[currentIndex + 1];
    if (
        currentIndex >= 0 &&
        events[currentIndex].isPlateAppearanceResult &&
        upcomingEvent &&
        upcomingEvent.kind !== "game-complete" &&
        upcomingEvent.inning !== events[currentIndex].inning
    ) {
        scopeStart = currentIndex + 1;
    }

    const targetInning = events[scopeStart]?.inning;
    if (!targetInning || targetInning === "Game Complete") return;
    let boundaryIndex = scopeStart;
    while (
        boundaryIndex < events.length &&
        events[boundaryIndex].inning === targetInning
    ) {
        boundaryIndex++;
    }
    revealThrough(boundaryIndex - 1);
}

function jumpToLive() {
    if (events.length === 0) return;
    const confirmed = confirm("Reveal every event currently available and jump to live?");
    if (!confirmed) return;

    revealThrough(events.length - 1);
}
function normalizePlayerName(name = "") {
    return String(name)
        .toLowerCase()
        .replace(/[.’']/g, "")
        .replace(/[^a-z0-9\u00c0-\u024f]+/g, " ")
        .trim();
}

function getTeamPlayer(team, name) {
    const target = normalizePlayerName(name);
    if (!target) return null;
    return (team.players || []).find(player =>
        normalizePlayerName(player.name) === target ||
        normalizePlayerName(player.short_name) === target
    ) || null;
}

function reconstructLineupAtRevealedPoint(team) {
    const lineup = (team.starters || [])
        .filter(player => {
            const spot = Number(player.spot);
            return spot >= 1 && spot <= 9;
        })
        .map(player => ({ ...player }))
        .sort((a, b) => Number(a.spot) - Number(b.spot));

    const findActiveIndex = name => {
        const target = normalizePlayerName(name);
        return lineup.findIndex(player => normalizePlayerName(player.name) === target);
    };

    const replaceInBattingSpot = (incomingName, outgoingName, position) => {
        if (!incomingName || !outgoingName) return;
        const incomingRoster = getTeamPlayer(team, incomingName);
        const outgoingIndex = findActiveIndex(outgoingName);

        // Do not infer a substitution unless the incoming player belongs to this
        // team and the outgoing player is actually active in this batting order.
        if (!incomingRoster || outgoingIndex < 0) return;

        lineup[outgoingIndex] = {
            ...lineup[outgoingIndex],
            name: incomingRoster.name || incomingName,
            uniform: incomingRoster.uniform || "",
            position: position || lineup[outgoingIndex].position || ""
        };
    };

    const changePosition = (playerName, position) => {
        if (!playerName || !position) return;
        if (!getTeamPlayer(team, playerName)) return;
        const index = findActiveIndex(playerName);
        if (index >= 0) lineup[index].position = position;
    };

    revealedIndexes.forEach(index => {
        const narrative = String(events[index]?.rawNarrative || "").trim();
        if (!narrative) return;

        let match = narrative.match(/^(.+?)\s+pinch hit for\s+(.+?)[.]?$/i);
        if (match) {
            replaceInBattingSpot(match[1].trim(), match[2].trim(), "ph");
            return;
        }

        match = narrative.match(/^(.+?)\s+pinch ran for\s+(.+?)[.]?$/i);
        if (match) {
            replaceInBattingSpot(match[1].trim(), match[2].trim(), "pr");
            return;
        }

        match = narrative.match(/^(.+?)\s+to\s+([a-z0-9]+)\s+for\s+(.+?)[.]?$/i);
        if (match) {
            replaceInBattingSpot(match[1].trim(), match[3].trim(), match[2].toLowerCase());
            return;
        }

        match = narrative.match(/^(.+?)\s+to\s+([a-z0-9]+)[.]?$/i);
        if (match) {
            changePosition(match[1].trim(), match[2].toLowerCase());
        }
    });

    return lineup;
}

function showLineup(teamSide) {
    if (!currentGameData) {
        alert("Game data is still loading.");
        return;
    }

    const team = currentGameData.teams.find(
        team => team.side === teamSide
    );

    if (!team) {
        alert("Team data is not available.");
        return;
    }

    const lineup = reconstructLineupAtRevealedPoint(team);

    let lineupHtml = "";

    if (lineup.length === 0) {
        lineupHtml =
            "<p>Lineup is not available yet.</p>";
    } else {
        lineupHtml = "<ol class='lineup-list'>";

        lineup.forEach(player => {
            const number = player.uniform
                ? `#${player.uniform}`
                : "";

            const position =
                (player.position || "—").toUpperCase();

            lineupHtml += `
                <li>
                    <span class="lineup-player">
                        ${number} ${player.name}
                    </span>
                    <span class="lineup-position">
                        ${position}
                    </span>
                </li>
            `;
        });

        lineupHtml += "</ol>";
    }

    document.getElementById("lineupTitle").innerHTML =
        `${team.name} Lineup at Revealed Point`;

    document.getElementById("lineupBody").innerHTML =
        lineupHtml;

    document.getElementById("lineupModal")
        .classList.remove("hidden");
}
function closeLineup() {
    document.getElementById("lineupModal").classList.add("hidden");
}
loadWPBLGames();

setInterval(() => {
    if (selectedGameId) {
        loadGame(false);
    }
}, 15000);
