const WPBL_API_BASE = "https://wpbl-api.4d8v7jw78c.workers.dev";

const WPBL_TEST_GAME_ID = "v7zr9elz0xc5lqbw";

let GAME_DATE = "2026-05-29";
let SAVE_KEY = `wpbl-tracker-${GAME_DATE}`;

let events = [];
let revealedIndexes = [];

let awayTeamName = "";
let homeTeamName = "";
let currentGameData = null;
let currentGamePk = null;

function setGameDate(newDate) {
    GAME_DATE = newDate;
    SAVE_KEY = `wpbl-tracker-${GAME_DATE}`;
    events = [];
    revealedIndexes = [];
    loadGame();
}

function loadToday() {
    const today = new Date().toISOString().split("T")[0];
    setGameDate(today);
}

function loadYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    setGameDate(yesterday.toISOString().split("T")[0]);
}

function loadPickedDate() {
    const pickedDate = document.getElementById("gameDate").value;

    if (!pickedDate) {
        alert("Pick a date first.");
        return;
    }

    setGameDate(pickedDate);
}

async function loadGame(askResume = true) {
    if (askResume) {
    document.getElementById("status").innerHTML = "Loading WPBL game...";
    document.getElementById("batterInfo").innerHTML = "";
    document.getElementById("eventList").innerHTML = "";
}

    const gameId = WPBL_TEST_GAME_ID;

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

    // For home runs, WPBL's runs_scored may omit the batter.
    // The narrative gives us the correct RBI total.
    const isHomeRun =
        /homered|home run/i.test(narrative);

    if (isHomeRun) {
        const rbiMatch = narrative.match(/(\d+)\s+RBI/i);

        if (rbiMatch) {
            return Number(rbiMatch[1]);
        }
    }

    return Number(play.runs_scored) || 0;
}
function buildEvents(data) {
    events = [];

    const plays = data.plays || [];

    plays.forEach((play, playNumber) => {
        const inning = play.inning;
        const half = (play.half || "").toUpperCase();
        const batter = play.batter_name || "";
        const pitcher = play.pitcher_name || "";

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
            } else if (code === "P") {
    text = pitch.description || "Pitch";
}

            events.push({
                inning: `${half} ${inning}`,
                batter: batter,
                pitcher: pitcher,
                text: text,
                atBat: playNumber,
                balls: balls,
                strikes: strikes,
                outs: play.outs,
                pitchNumber: pitchIndex + 1
            });
        });

        // Add the completed play / plate appearance
        if (play.narrative) {
            events.push({
                inning: `${half} ${inning}`,
                batter: batter,
                pitcher: pitcher,
                text: `RESULT: ${play.narrative} [DEBUG raw=${play.runs_scored} calc=${getRunsScored(play)} type=${play.event_type}]`,
                atBat: playNumber,
                balls: play.balls,
                strikes: play.strikes,
                outs: play.outs,
                pitchNumber: null,

                eventType: play.event_type,
                battingSide: half === "TOP" ? "away" : "home",

                // We'll calculate spoiler-safe scores from runs scored,
                // rather than exposing the live final/current score.
                runsScored: getRunsScored(play),

                isHit: play.is_hit || false,
                isScoringPlay: play.is_scoring_play || false
            });
        }
    });
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
function updateStatus() {
    const currentIndex = getCurrentIndex();
const score = getSpoilerFreeScore();
const totals = getSpoilerFreeHitsErrors();
    

    
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

    const event = events[currentIndex];
    
    const pitcherPitchCount = getPitcherPitchCount(event.pitcher);
    
    const countText =
        event.balls !== undefined && event.strikes !== undefined
            ? `${event.balls}-${event.strikes}`
            : "N/A";

    const outsText =
        event.outs !== undefined
            ? `${event.outs} out(s)`
            : "N/A";

    const pitchText =
        event.pitchNumber
            ? `Pitch #${event.pitchNumber}`
            : "Plate appearance result";

    const balls = event.balls ?? 0;
const strikes = event.strikes ?? 0;
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
    <div class="inning-line">${event.inning}</div>

    <div class="matchup-line">
        <strong>${event.pitcher} (${pitcherPitchCount})</strong>
        <span> vs </span>
        <strong>${event.batter}</strong>
    </div>

    <div class="count-line">
        <span>⚾ <span class="count-dots">${ballDots}</span></span>
<span><strong>K</strong> <span class="count-dots">${strikeDots}</span></span>
<span>❌ <span class="count-dots">${outDots}</span></span>
    </div>
`;
}

function getEventIcon(event) {
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
    row.className = "event-row";

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

    if (currentIndex === -1) {
        nextEvent();
        return;
    }

    const currentAtBat = events[currentIndex].atBat;
    let nextIndex = currentIndex + 1;

    while (
        nextIndex < events.length &&
        events[nextIndex].atBat === currentAtBat
    ) {
        nextIndex++;
    }

    if (nextIndex < events.length) {
        revealIndex(nextIndex);
    }
}

function nextInning() {
    const currentIndex = getCurrentIndex();

    if (currentIndex === -1) {
        nextEvent();
        return;
    }

    const currentInning = events[currentIndex].inning;
    let nextIndex = currentIndex + 1;

    while (
        nextIndex < events.length &&
        events[nextIndex].inning === currentInning
    ) {
        nextIndex++;
    }

    if (nextIndex < events.length) {
        revealIndex(nextIndex);
    }
}
function showLineup(teamSide) {
    if (!currentGameData) {
        alert("Game data is still loading.");
        return;
    }

    const teamData = currentGameData.gameData.teams[teamSide];
    const teamName = teamData.teamName;

    const currentIndex = getCurrentIndex();
    const maxAtBat =
        currentIndex === -1
            ? -1
            : events[currentIndex].atBat;

    const lineup = getLineupAtPoint(teamSide, maxAtBat);

    let lineupHtml = "";

    if (lineup.length === 0) {
        lineupHtml = "<p>Lineup is not available yet for this point in the game.</p>";
    } else {
        lineupHtml = "<ol class='lineup-list'>";

        lineup.forEach(player => {
            lineupHtml += `
                <li>
                    <span class="lineup-player">${player.name}</span>
                    <span class="lineup-position">${player.position}</span>
                </li>
            `;
        });

        lineupHtml += "</ol>";
    }

    document.getElementById("lineupTitle").innerHTML = `${teamName} Lineup`;
    document.getElementById("lineupBody").innerHTML = lineupHtml;
    document.getElementById("lineupModal").classList.remove("hidden");
}
function getLineupAtPoint(teamSide, maxAtBat) {
    const plays = currentGameData.liveData.plays.allPlays;
    const boxscoreTeam = currentGameData.liveData.boxscore.teams[teamSide];
    const players = boxscoreTeam.players || {};

    const lineupMap = new Map();

    plays.forEach((play, playIndex) => {
        const battingSide =
            play.about.halfInning === "top" ? "away" : "home";

        if (battingSide !== teamSide) return;

        const batterId = play.matchup.batter.id;
        const batterKey = `ID${batterId}`;
        const batterInfo = players[batterKey];

        if (!batterInfo) return;

        const battingOrder = batterInfo.battingOrder;
        if (!battingOrder) return;

        const lineupSpot = Math.floor(Number(battingOrder) / 100);
        if (lineupSpot < 1 || lineupSpot > 9) return;

        // First time we see a lineup spot = starter.
        if (!lineupMap.has(lineupSpot)) {
            lineupMap.set(lineupSpot, {
                name: batterInfo.person.fullName,
                position: batterInfo.position?.abbreviation || "—"
            });
        }

        // After revealed point, do not apply future substitutions.
        if (maxAtBat !== -1 && playIndex > maxAtBat) {
            return;
        }

        // Up to revealed point, update if a new player appears in that spot.
        lineupMap.set(lineupSpot, {
            name: batterInfo.person.fullName,
            position: batterInfo.position?.abbreviation || "—"
        });
    });

    return Array.from(lineupMap.entries())
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(entry => entry[1]);
}
function closeLineup() {
    document.getElementById("lineupModal").classList.add("hidden");
}
loadGame();

setInterval(() => {
    loadGame(false);
}, 15000);
