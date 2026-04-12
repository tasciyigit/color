// --- P2P Network Logic ---
let peer = null;
let conn = null;
let isHost = false;

// --- Match State ---
let gameState = {
    isMultiplayer: false,
    scoreLimit: 3,
    hostScore: 0,
    guestScore: 0,
    targetColor: { h:0, s:0, l:0 },
    
    // Round transient state
    hostGuessed: false,
    hostGuessScore: 0,
    guestGuessed: false,
    guestGuessScore: 0
};

// Local UI state
let localGuess = { h: 180, s: 50, l: 50 };
let gameTimer = null;
let resultTimer = null;

// DOM Elements
const screens = {
    home: document.getElementById('home-screen'),
    lobby: document.getElementById('lobby-screen'),
    color: document.getElementById('color-screen'),
    guess: document.getElementById('guess-screen'),
    roundResult: document.getElementById('round-result-screen'),
    matchResult: document.getElementById('match-result-screen'),
    soloResult: document.getElementById('solo-result-screen')
};

const elems = {
    logo: document.getElementById('logo'),
    liveScoreboard: document.getElementById('live-scoreboard'),
    scoreSelf: document.getElementById('score-self'),
    scoreOpponent: document.getElementById('score-opponent'),
    
    waitingOverlay: document.getElementById('waiting-overlay'),
    waitingSubtext: document.getElementById('waiting-subtext'),

    // Lobby
    lobbyCode: document.getElementById('lobby-code-display'),
    lobbyStatus: document.getElementById('lobby-status'),
    hostControls: document.getElementById('host-controls'),
    targetScoreInput: document.getElementById('target-score-input'),
    
    // Round Results
    roundTitle: document.getElementById('round-title'),
    roundSubtitle: document.getElementById('round-subtitle'),
    roundScoreSelf: document.getElementById('round-score-self'),
    roundScoreOpp: document.getElementById('round-score-opponent'),
    roundTimerText: document.getElementById('round-timer'),
    
    // Match Results
    matchWinnerText: document.getElementById('match-winner-text'),
    finalScoreSelf: document.getElementById('final-score-self'),
    finalScoreOpp: document.getElementById('final-score-opponent'),
    
    // Colors
    targetDisplay: document.getElementById('target-color-display'),
    guessDisplay: document.getElementById('guess-color-preview'),
    countdown: document.getElementById('countdown'),
    
    // Misc
    notification: document.getElementById('notification'),
    shareModal: document.getElementById('share-modal'),
    shareText: document.getElementById('share-text')
};

function init() {
    // Buttons
    document.getElementById('btn-solo').addEventListener('click', startSoloMatch);
    
    document.getElementById('btn-multi-create').addEventListener('click', createRoom);
    document.getElementById('btn-join-room').addEventListener('click', () => {
        const code = document.getElementById('join-room-input').value.trim().toUpperCase();
        if (code.length > 0) joinRoom(code);
        else showNotification("Geçerli bir kod girin");
    });
    
    document.getElementById('btn-start-match').addEventListener('click', () => {
        if(isHost) {
            gameState.scoreLimit = parseInt(elems.targetScoreInput.value) || 3;
            startNewRound();
        }
    });

    document.getElementById('btn-submit').addEventListener('click', submitGuess);
    elems.logo.addEventListener('click', goHome);
    document.getElementById('btn-home-match').addEventListener('click', goHome);
    
    // Web Share
    document.getElementById('btn-share').addEventListener('click', shareResult);
    document.getElementById('btn-close-modal').addEventListener('click', () => elems.shareModal.classList.add('hidden'));
    document.getElementById('btn-copy-modal').addEventListener('click', copyShareText);
    
    // Solo Buttons
    document.getElementById('btn-solo-play-again').addEventListener('click', startSoloMatch);
    document.getElementById('btn-solo-home').addEventListener('click', goHome);
    document.getElementById('btn-solo-share').addEventListener('click', shareSoloResult);

    // Sliders
    ['h', 's', 'l'].forEach(key => {
        document.getElementById(`slider-${key}`).addEventListener('input', (e) => {
            localGuess[key] = parseInt(e.target.value);
            updateGuessPreview();
        });
    });

    // Check URL params
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('oda');
    if (roomFromUrl) {
        joinRoom(roomFromUrl);
    }
}

function showNotification(msg) {
    elems.notification.innerText = msg;
    elems.notification.classList.remove('hidden');
    setTimeout(() => elems.notification.classList.add('hidden'), 3500);
}

function switchScreen(screenId) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenId].classList.add('active');
}

function stringifyHSL(h, s, l) {
    return `hsl(${h}, ${s}%, ${l}%)`;
}

function circularDiff(a, b, maxField) {
    let diff = a - b;
    if (diff > maxField / 2) diff -= maxField;
    if (diff < -maxField / 2) diff += maxField;
    return diff;
}

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start) + "%";
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function goHome() {
    clearInterval(gameTimer);
    clearInterval(resultTimer);
    cleanupPeer();
    
    window.history.replaceState({}, '', window.location.pathname);
    gameState.isMultiplayer = false;
    elems.liveScoreboard.classList.add('hidden');
    elems.waitingOverlay.classList.add('hidden');
    
    switchScreen('home');
}

// ------ PEERJS NETWORK ------

function cleanupPeer() {
    if (conn) { conn.close(); conn = null; }
    if (peer) { peer.destroy(); peer = null; }
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// HOST LOGIC
function createRoom() {
    const code = generateRoomCode();
    window.history.replaceState({}, '', `?oda=${code}`);
    
    showOverlay("Oda Oluşturuluyor...");
    
    peer = new Peer(`renk-game-${code}`); // Prefix to avoid global clashes
    
    peer.on('open', (id) => {
        hideOverlay();
        isHost = true;
        gameState.isMultiplayer = true;
        
        elems.lobbyCode.innerText = code;
        elems.lobbyStatus.innerText = "Bağlantı kuruldu, rakip bekleniyor...";
        elems.lobbyStatus.style.color = "var(--text-muted)";
        elems.hostControls.classList.add('hidden');
        switchScreen('lobby');
    });

    peer.on('connection', (connection) => {
        conn = connection;
        conn.on('open', () => {
            setupConnectionCallbacks();
            
            elems.lobbyStatus.innerText = "Rakip Katıldı! 🎉";
            elems.lobbyStatus.style.color = "var(--win)";
            elems.hostControls.classList.remove('hidden');
            showNotification("Bir oyuncu bağlandı!");

            sendData('ROOM_JOINED_ACK', { roomCode: code });
        });
    });

    peer.on('error', (err) => {
        hideOverlay();
        if(err.type === 'unavailable-id') {
            showNotification("Bu oda kodu zaten alınmış, tekrar deneyin.");
        } else {
            showNotification("Hata oluştu: " + err.type);
        }
        goHome();
    });
}

// GUEST LOGIC
function joinRoom(code) {
    window.history.replaceState({}, '', `?oda=${code}`);
    showOverlay("Odaya Bağlanılıyor...");
    
    peer = new Peer();
    peer.on('open', (id) => {
        conn = peer.connect(`renk-game-${code}`);
        setupConnectionCallbacks(); // Bind data listeners unconditionally immediately!
        
        conn.on('open', () => {
            // Also as fallback
        });
    });

    peer.on('error', (err) => {
        hideOverlay();
        if (err.type === 'peer-unavailable') {
            showNotification(code + " odası bulunamadı. Kurucu sayfayı yenilemiş veya odadan ayrılmış olabilir.");
        } else {
            showNotification("Bağlantı hatası: " + err.type);
        }
        goHome();
    });
}

function setupConnectionCallbacks() {
    conn.on('data', (data) => {
        console.log("Received data:", data);
        if (data.type === 'ROOM_JOINED_ACK') {
            hideOverlay();
            isHost = false;
            gameState.isMultiplayer = true;
            
            elems.lobbyCode.innerText = data.payload.roomCode;
            elems.lobbyStatus.innerText = "Odaya başarıyla bağlandın. Maçın sahibinin başlatması bekleniyor...";
            elems.lobbyStatus.style.color = "var(--win)";
            elems.hostControls.classList.add('hidden');
            switchScreen('lobby');
        }
        if (data.type === 'START_ROUND') handleStartRoundPhase(data.payload);
        if (data.type === 'GUEST_GUESS' && isHost) handleGuestGuess(data.payload);
        if (data.type === 'ROUND_RESULT') handleRoundResult(data.payload);
        if (data.type === 'MATCH_RESULT') handleMatchResult(data.payload);
    });

    conn.on('close', () => {
        showNotification("Rakip oyundan ayrıldı.");
        goHome();
    });
}

function sendData(type, payload) {
    if (conn && conn.open) {
        conn.send({ type, payload });
    }
}

// ------ GAME LOGIC ------

function startSoloMatch() {
    isHost = true;
    gameState.isMultiplayer = false;
    gameState.scoreLimit = 5; // default solo rounds? Or infinite?
    gameState.hostScore = 0;
    elems.liveScoreboard.classList.add('hidden');
    startNewRound();
}

function startNewRound() {
    // Both Host and Solo start round logic
    gameState.hostGuessed = false;
    gameState.guestGuessed = false;
    
    gameState.targetColor = {
        h: Math.floor(Math.random() * 360),
        s: Math.floor(Math.random() * 70) + 30, // 30-100%
        l: Math.floor(Math.random() * 60) + 20  // 20-80%
    };

    if (gameState.isMultiplayer) {
        sendData('START_ROUND', {
            targetColor: gameState.targetColor,
            scores: { host: gameState.hostScore, guest: gameState.guestScore },
            limit: gameState.scoreLimit
        });
    }

    handleStartRoundPhase({
        targetColor: gameState.targetColor,
        scores: { host: gameState.hostScore, guest: gameState.guestScore },
        limit: gameState.scoreLimit
    });
}

function handleStartRoundPhase(payload) {
    gameState.targetColor = payload.targetColor;
    gameState.scoreLimit = payload.limit;
    
    // Update Scoreboard UI
    if (gameState.isMultiplayer) {
        elems.liveScoreboard.classList.remove('hidden');
        elems.scoreSelf.innerText = isHost ? payload.scores.host : payload.scores.guest;
        elems.scoreOpponent.innerText = isHost ? payload.scores.guest : payload.scores.host;
    }

    // Reset Guess UI
    localGuess = { h: 180, s: 50, l: 50 };
    document.getElementById('slider-h').value = localGuess.h;
    document.getElementById('slider-s').value = localGuess.s;
    document.getElementById('slider-l').value = localGuess.l;
    updateGuessPreview();

    // Show color
    elems.targetDisplay.style.backgroundColor = `hsl(${gameState.targetColor.h}, ${gameState.targetColor.s}%, ${gameState.targetColor.l}%)`;
    switchScreen('color');

    // Countdown
    let timeLeft = 3;
    elems.countdown.innerText = timeLeft;
    elems.countdown.style.opacity = '1';

    clearInterval(gameTimer);
    gameTimer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) elems.countdown.innerText = timeLeft;
        else if (timeLeft === 0) elems.countdown.style.opacity = '0';
        else {
            clearInterval(gameTimer);
            switchScreen('guess');
        }
    }, 1000);
}

function submitGuess() {
    const accuracy = calculateAccuracy(localGuess, gameState.targetColor);
    
    if (!gameState.isMultiplayer) {
        handleSoloResult(accuracy);
        return;
    }

    // Multiplayer Logic
    if (isHost) {
        gameState.hostGuessScore = accuracy;
        gameState.hostGuessed = true;
        checkRoundReady();
    } else {
        sendData('GUEST_GUESS', { score: accuracy });
        showOverlay("Diğer oyuncunun tahmini bekleniyor...");
    }
}

// Only Host executes this
function handleGuestGuess(payload) {
    gameState.guestGuessScore = payload.score;
    gameState.guestGuessed = true;
    checkRoundReady();
}

// Only Host executes this
function checkRoundReady() {
    if (gameState.hostGuessed && gameState.guestGuessed) {
        // Evaluate winner
        let winner = 'tie';
        if (gameState.hostGuessScore > gameState.guestGuessScore) {
            winner = 'host';
            gameState.hostScore += 1;
        } else if (gameState.guestGuessScore > gameState.hostGuessScore) {
            winner = 'guest';
            gameState.guestScore += 1;
        }

        const payload = {
            hostAcc: gameState.hostGuessScore,
            guestAcc: gameState.guestGuessScore,
            winner: winner,
            newScores: { host: gameState.hostScore, guest: gameState.guestScore },
            limit: gameState.scoreLimit
        };

        // Check Match Over
        if (gameState.hostScore >= gameState.scoreLimit || gameState.guestScore >= gameState.scoreLimit) {
            payload.matchOver = true;
            sendData('MATCH_RESULT', payload);
            handleMatchResult(payload);
        } else {
            // Next Round
            sendData('ROUND_RESULT', payload);
            handleRoundResult(payload);
        }
    } else {
        if(gameState.hostGuessed && !gameState.guestGuessed) {
            showOverlay("Rakibin tahmini bekleniyor...");
        }
    }
}

function handleRoundResult(payload) {
    hideOverlay();
    switchScreen('roundResult');

    const amIHost = isHost;
    const myAcc = amIHost ? payload.hostAcc : payload.guestAcc;
    const oppAcc = amIHost ? payload.guestAcc : payload.hostAcc;
    
    // Update Scoreboard UI
    if (gameState.isMultiplayer) {
        elems.scoreSelf.innerText = amIHost ? payload.newScores.host : payload.newScores.guest;
        elems.scoreOpponent.innerText = amIHost ? payload.newScores.guest : payload.newScores.host;
    }

    // Update Round Result UI
    elems.roundScoreSelf.innerText = myAcc + "%";
    elems.roundScoreOpp.innerText = oppAcc ? (oppAcc + "%") : "--";
    
    if (!gameState.isMultiplayer) {
        document.getElementById('opponent-score-card').classList.add('hidden');
        document.getElementById('self-score-card').style.flex = "none";
        document.getElementById('self-score-card').style.width = "100%";
        
        elems.roundTitle.innerText = "Tahmin Skoru!";
        elems.roundTitle.style.color = "var(--text-primary)";
        elems.roundSubtitle.innerText = "Kendini geçmeye devam et!";
    } else {
        document.getElementById('opponent-score-card').classList.remove('hidden');
        document.getElementById('self-score-card').style.flex = "1";

        if (payload.winner === 'tie') {
            elems.roundTitle.innerText = "Berabere!";
            elems.roundTitle.style.color = "var(--text-primary)";
            elems.roundSubtitle.innerText = "Puan verilmedi";
        } else {
            const iWon = (amIHost && payload.winner === 'host') || (!amIHost && payload.winner === 'guest');
            if (iWon) {
                elems.roundTitle.innerText = "Turu Sen Kazandın! 🎉";
                elems.roundTitle.style.color = "var(--win)";
                elems.roundSubtitle.innerText = "+1 Puan kazandın";
            } else {
                elems.roundTitle.innerText = "Turu Kaybettin";
                elems.roundTitle.style.color = "var(--lose)";
                elems.roundSubtitle.innerText = "Rakip +1 puan aldı";
            }
        }
    }

    // Auto next round timer
    let waitSecs = 5;
    elems.roundTimerText.innerText = `Sonraki tur ${waitSecs} saniye içinde başlıyor...`;
    
    clearInterval(resultTimer);
    resultTimer = setInterval(() => {
        waitSecs--;
        if(waitSecs > 0) elems.roundTimerText.innerText = `Sonraki tur ${waitSecs} saniye içinde başlıyor...`;
        else {
            clearInterval(resultTimer);
            if(isHost) startNewRound();
        }
    }, 1000);
}

function handleSoloResult(accuracy) {
    hideOverlay();
    switchScreen('soloResult');
    
    document.getElementById('solo-result-target').style.backgroundColor = stringifyHSL(gameState.targetColor.h, gameState.targetColor.s, gameState.targetColor.l);
    document.getElementById('solo-result-guess').style.backgroundColor = stringifyHSL(localGuess.h, localGuess.s, localGuess.l);
    
    // Save to globals for sharing
    window.lastScore = accuracy;
    animateValue(document.getElementById('solo-final-score'), 0, accuracy, 1000);
    
    let hDiff = circularDiff(localGuess.h, gameState.targetColor.h, 360);
    let sDiff = localGuess.s - gameState.targetColor.s;
    let lDiff = localGuess.l - gameState.targetColor.l;
    
    setSoloStatBar('h', hDiff, 180, '');
    setSoloStatBar('s', sDiff, 100, '%');
    setSoloStatBar('l', lDiff, 100, '%');
}

function setSoloStatBar(id, diff, maxVal, unit) {
    const bar = document.getElementById(`solo-bar-${id}`);
    const valText = document.getElementById(`solo-diff-${id}`);
    
    if (diff > 0) {
        bar.style.left = '50%';
        bar.style.width = `${(Math.abs(diff)/maxVal)*50}%`;
    } else {
        bar.style.left = `${50 - (Math.abs(diff)/maxVal)*50}%`;
        bar.style.width = `${(Math.abs(diff)/maxVal)*50}%`;
    }
    
    // Explicit Sign Coloring
    if (diff === 0) {
        valText.innerText = `0${unit}`;
        bar.style.backgroundColor = 'var(--text-muted)';
        valText.style.color = 'var(--text-muted)';
        bar.style.left = '49%'; bar.style.width = '2%'; // tiny tick
    } else if (diff > 0) {
        valText.innerText = `+${diff}${unit}`;
        bar.style.backgroundColor = 'var(--win)'; // Green
        valText.style.color = 'var(--win)';
    } else {
        valText.innerText = `${diff}${unit}`; // Native negative sign is included in diff
        bar.style.backgroundColor = 'var(--lose)'; // Red
        valText.style.color = 'var(--lose)';
    }
}

function handleMatchResult(payload) {
    hideOverlay();
    switchScreen('matchResult');
    elems.liveScoreboard.classList.add('hidden');

    const amIHost = isHost;
    const myScore = amIHost ? payload.newScores.host : payload.newScores.guest;
    const oppScore = amIHost ? payload.newScores.guest : payload.newScores.host;
    
    elems.finalScoreSelf.innerText = myScore;
    elems.finalScoreOpp.innerText = oppScore;

    const iWon = myScore > oppScore;
    if (iWon) {
        elems.matchWinnerText.innerText = "Sen Kazandın! 🏆";
        elems.matchWinnerText.style.color = "var(--win)";
    } else {
        elems.matchWinnerText.innerText = "Kaybettin!";
        elems.matchWinnerText.style.color = "var(--lose)";
    }

    // Save for sharing
    window.matchShareData = { iWon, myScore, oppScore, limit: payload.limit };
}

// ------ HELPERS ------

function updateGuessPreview() {
    const { h, s, l } = localGuess;
    elems.guessDisplay.style.backgroundColor = `hsl(${h}, ${s}%, ${l}%)`;
    document.getElementById('val-h').innerText = h;
    document.getElementById('val-s').innerText = s + '%';
    document.getElementById('val-l').innerText = l + '%';

    document.getElementById('slider-h').style.background = `linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)`;
    document.getElementById('slider-s').style.background = `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`;
    document.getElementById('slider-l').style.background = `linear-gradient(to right, hsl(${h}, ${s}%, 0%), hsl(${h}, ${s}%, 50%), hsl(${h}, ${s}%, 100%))`;
}

function calculateAccuracy(guess, target) {
    let diff = guess.h - target.h;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const hPct = Math.abs(diff) / 180;
    const sPct = Math.abs(guess.s - target.s) / 100;
    const lPct = Math.abs(guess.l - target.l) / 100;

    const error = (hPct * 0.5) + (sPct * 0.25) + (lPct * 0.25);
    return Math.max(0, Math.round((1 - error) * 100));
}

function showOverlay(text) {
    elems.waitingSubtext.innerText = text;
    elems.waitingOverlay.classList.remove('hidden');
}

function hideOverlay() {
    elems.waitingOverlay.classList.add('hidden');
}

function shareResult() {
    const data = window.matchShareData || {};
    const textStatus = data.iWon ? "Ezdim" : "Kıl payı kaybettim";
    const base = window.location.origin + window.location.pathname;
    
    let text = `🎨 Renk Hafıza Oyunu\n\nArkadaşımı (${data.myScore} - ${data.oppScore}) skoruyla ${textStatus}!\nKazanma Hedefi: ${data.limit}\n\nSen de kendi arkadaşlarına meydan oku:\n${base}`;

    if (navigator.share) {
        navigator.share({
            title: 'Renk Hafıza Oyunu',
            text: text
        }).catch(err => {
            console.log("Paylaşım hatası:", err);
            fallbackShare(text);
        });
    } else {
        fallbackShare(text);
    }
}

function shareSoloResult() {
    const base = window.location.origin + window.location.pathname;
    let text = `🎨 Renk Hafıza Oyunu\n\nSolo skorum: %${window.lastScore}\n\nSen de hafızanı test et:\n${base}`;

    if (navigator.share) {
        navigator.share({
            title: 'Renk Hafıza Oyunu',
            text: text
        }).catch(err => {
            console.log("Paylaşım hatası:", err);
            fallbackShare(text);
        });
    } else {
        fallbackShare(text);
    }
}

function fallbackShare(text) {
    elems.shareText.value = text;
    elems.shareModal.classList.remove('hidden');
    document.getElementById('btn-copy-modal').innerText = "Kopyala";
}

function copyShareText() {
    elems.shareText.select();
    navigator.clipboard.writeText(elems.shareText.value).then(() => {
        document.getElementById('btn-copy-modal').innerText = "✅ Kopyalandı!";
        showNotification("Panoya kopyalandı!");
        setTimeout(() => elems.shareModal.classList.add('hidden'), 1500);
    }).catch(() => {
        document.execCommand('copy');
        document.getElementById('btn-copy-modal').innerText = "✅ Kopyalandı!";
    });
}

init();
