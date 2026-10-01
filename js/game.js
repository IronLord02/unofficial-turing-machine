// ============================================================
// Turing Machine - Compact Grid Edition
// Game logic ported from amoshk/turing-web.github.io
// UI rewritten for compact rectangle verifiers
// ============================================================

(function () {
    'use strict';

    // === Legacy browser polyfills (Android 4.4 / old WebKit) ===
    // Array.prototype.fill (ES6) is missing on old engines. Without it,
    // init() crashes and the whole game appears dead.
    if (!Array.prototype.fill) {
        Array.prototype.fill = function (value) {
            for (var i = 0; i < this.length; i++) {
                this[i] = value;
            }
            return this;
        };
    }
    // classList multi-token add/remove and 2-argument toggle are missing
    // on old WebKit (only one-token operations exist).
    if (document.createElement('div').classList && window.DOMTokenList) {
        (function () {
            var proto = DOMTokenList.prototype;
            var add = proto.add;
            var remove = proto.remove;
            var toggle = proto.toggle;
            if (add && add.length < 2) {
                proto.add = function () {
                    for (var i = 0; i < arguments.length; i++) {
                        add.call(this, arguments[i]);
                    }
                };
            }
            if (remove && remove.length < 2) {
                proto.remove = function () {
                    for (var i = 0; i < arguments.length; i++) {
                        remove.call(this, arguments[i]);
                    }
                };
            }
            if (toggle && toggle.length < 2) {
                proto.toggle = function (token, force) {
                    if (force === undefined) {
                        return toggle.call(this, token);
                    }
                    var present = this.contains(token);
                    if (force) {
                        if (!present) { add.call(this, token); }
                    } else {
                        if (present) { remove.call(this, token); }
                    }
                };
            }
        })();
    }

    // --- State ---
    var pattern = null;
    var allCards = null;
    var cardNone = null;
    var criterias = null;
    var level = null;
    var selectedCode = ['x', 'x', 'x']; // A, B, C
    var gameOver = false;               // solution checked / given up: board is locked down
    var modalGuess = null;              // current guess inside the solution modal
    var markMode = false;               // pencil mode: verifiers are selectable for marking
    var verifierMarks = {};             // criterion name -> Set of marked opts (visual notes only)

    // Turn-based game state (physical game rules: max 3 verifications per turn)
    var turnNumber = 1;
    var maxVerifications = 3;
    var verificationsUsed = 0;
    var turnBlocked = false;
    var turnCode = null;         // code locked for the current turn after first verification
    var verifiedIndices = {};    // verifier index -> result (true=green, false=red) this turn
    var turnResults = [];        // [{index, result}] verifications accumulated this turn
    var history = [];            // [{turn, code, verifications:[{index, result}]}] finalized when the turn passes
    var selectedVerifiers = {};  // verifier index -> true (pending reveal this turn)
    var revealedThisTurn = false; // reveal animation ran; button now says "Pass Turn"

    // --- Pattern Loading ---
    function patternLoad(data) {
        var idx = 0;
        var slots = parseInt(data.charAt(idx++));
        var order = parseInt(data.charAt(idx++));
        var nb = Math.pow(order, slots);
        var patterns = [];

        for (var i = 0; i < nb; i++) {
            var pat = [];
            for (var s = 0; s < slots; s++) {
                pat.push(parseInt(data.charAt(idx++)));
            }
            patterns.push({ n: pat });
        }

        return { pattern: patterns, order: order, slots: slots };
    }

    // --- Card Generation ---
    function criteriaGenerate(patterns, name, fullname, criteriaFn, parent) {
        var tab = [];
        for (var i = 0; i < patterns.pattern.length; i++) {
            tab[i] = criteriaFn(patterns.pattern[i]);
        }
        return {
            name: name,
            fullname: fullname,
            card: tab,
            parent: parent || null
        };
    }

    function generateCards(pat) {
        var c = [];
        for (var s = 0; s < pat.slots; s++) {
            var slot = [];
            for (var o = 0; o < pat.order; o++) {
                var name = '';
                for (var ns = 0; ns < pat.slots; ns++) {
                    name += (ns === s) ? (o + 1) : 'x';
                }
                slot.push(criteriaGenerate(pat, name, name, (function (slotIdx, val) {
                    return function (p) { return p.n[slotIdx] === val; };
                })(s, o + 1)));
            }
            c.push(slot);
        }
        return c;
    }

    // --- Card Operations ---
    function cardsCompute(card1, card2) {
        var c = [];
        for (var i = 0; i < card1.length; i++) {
            c.push(card1[i] && card2[i]);
        }
        return c;
    }

    function generateCode(cards, a, b, c) {
        var none = [];
        for (var i = 0; i < cards[0][0].card.length; i++) {
            none.push(true);
        }

        var c1 = { card: none, name: 'xxx' };
        var c2 = { card: none, name: 'xxx' };
        var c3 = { card: none, name: 'xxx' };

        if (a !== 'x') c1 = cards[0][parseInt(a) - 1];
        if (b !== 'x') c2 = cards[1][parseInt(b) - 1];
        if (c !== 'x') c3 = cards[2][parseInt(c) - 1];

        return {
            name: a + b + c,
            card: cardsCompute(cardsCompute(c1.card, c2.card), c3.card)
        };
    }

    function countTrue(t) {
        var cnt = 0;
        for (var i = 0; i < t.length; i++) {
            if (t[i]) cnt++;
        }
        return cnt;
    }

    function compareArray(a1, a2) {
        if (a1.length !== a2.length) return false;
        for (var i = 0; i < a1.length; i++) {
            if (a1[i] !== a2[i]) return false;
        }
        return true;
    }

    // --- Level Validation ---
    function checkLevel(l) {
        for (var c = 0; c < l.length; c++) {
            var o = cardNone.card;
            for (var i = 0; i < l.length; i++) {
                if (i !== c) {
                    o = cardsCompute(o, l[i].card);
                }
            }
            var oN = cardsCompute(o, l[c].card);
            if (compareArray(o, oN)) return false;
        }
        var s = solutions(l);
        if (s.length !== 1) return false;
        return true;
    }

    function solutions(verifiers) {
        var o = cardNone.card;
        for (var i = 0; i < verifiers.length; i++) {
            o = cardsCompute(o, verifiers[i].card);
        }
        var sol = [];
        for (var i = 0; i < pattern.pattern.length; i++) {
            if (o[i]) sol.push(pattern.pattern[i]);
        }
        return sol;
    }

    // Check that no two selected verifier answer cards are mutually exclusive.
    // Two cards contradict when no code in the space satisfies both simultaneously.
    function checkNoContradictions(level) {
        for (var i = 0; i < level.length; i++) {
            for (var j = i + 1; j < level.length; j++) {
                var intersection = cardsCompute(level[i].card, level[j].card);
                if (countTrue(intersection) === 0) {
                    return {
                        valid: false,
                        pair: [i, j],
                        reason: 'Verifiers ' + (i + 1) + ' and ' + (j + 1) + ' are mutually exclusive'
                    };
                }
            }
        }
        return { valid: true };
    }

    // Check that every code in the space produces a unique answer vector.
    // A fully-provable level guarantees that no two codes are indistinguishable:
    // each code has a unique YES/NO fingerprint across all selected verifiers,
    // so the solution is 100% determinable using only these verifiers.
    function checkFullResolvability(level) {
        var groups = {};
        for (var p = 0; p < pattern.pattern.length; p++) {
            var vector = '';
            for (var v = 0; v < level.length; v++) {
                vector += level[v].card[p] ? '1' : '0';
            }
            if (!groups[vector]) groups[vector] = [];
            groups[vector].push(pattern.pattern[p].n.join(''));
        }

        var uniquePatterns = 0;
        var ambiguousGroups = [];
        for (var vec in groups) {
            if (groups[vec].length === 1) {
                uniquePatterns++;
            } else {
                ambiguousGroups.push({ vector: vec, codes: groups[vec] });
            }
        }

        return {
            fullyResolvable: ambiguousGroups.length === 0,
            uniquePatterns: uniquePatterns,
            totalCodes: pattern.pattern.length,
            ambiguousGroups: ambiguousGroups
        };
    }

    // --- Exhaustive Validation ---
    // Independent full-space scan: checks EVERY possible code against EVERY answer card.
    // A level is valid only when exactly one code in the whole space is consistent with all
    // verifier answers, i.e. the player can always deduce a UNIQUE solution.
    function validateLevelExhaustive(l) {
        var result = { valid: false, solution: null, consistentCount: 0 };
        for (var p = 0; p < pattern.pattern.length; p++) {
            var consistent = true;
            for (var v = 0; v < l.length; v++) {
                if (!l[v].card[p]) {
                    consistent = false;
                    break;
                }
            }
            if (consistent) {
                result.solution = pattern.pattern[p].n[0] + '' + pattern.pattern[p].n[1] + '' + pattern.pattern[p].n[2];
                result.consistentCount++;
            }
        }
        result.valid = result.consistentCount === 1;
        return result;
    }

    // --- Level Generation ---
    function shuffleArray(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    // The answer card of a criterion satisfied by the code at pattern index si.
    function cardForCode(criterion, si) {
        for (var k = 0; k < criterion.cards.length; k++) {
            if (criterion.cards[k].card[si]) return criterion.cards[k];
        }
        return null; // every code satisfies exactly one answer per criterion
    }

    // Code-first generator with a hard bound:
    // 1) pick a random secret code (the canonical solution),
    // 2) pick n criteria at random and force each answer card to the one the secret satisfies,
    // 3) accept only when every verifier adds information (checkLevel), so the secret is the
    //    UNIQUE code consistent with the answers.
    // Never hangs: returns null when the combination is not feasible in time.
    function generateLevel(n, d) {
        var maxAttempts = 60000;
        var deadline = Date.now() + 4000;
        for (var attempt = 0; attempt < maxAttempts; attempt++) {
            if (Date.now() > deadline) return null;
            var si = Math.floor(Math.random() * pattern.pattern.length);
            var selected = [];
            for (var i = 0; i < criterias.length; i++) {
                if (criterias[i].difficulty >= d - 1 && criterias[i].difficulty <= d) {
                    selected.push(criterias[i]);
                }
            }
            if (selected.length < n) return null;
            shuffleArray(selected);
            var l = [];
            var ok = true;
            for (var i = 0; i < n; i++) {
                var card = cardForCode(selected[i], si);
                if (!card) {
                    ok = false;
                    break;
                }
                l.push(card);
            }
            if (!ok) continue;
            if (checkLevel(l) && checkNoContradictions(l).valid) return l;
        }
        return null;
    }

    // --- All 48 Criteria Definitions ---
    function createAllCriteria(pat) {
        var cr = [];
        var tmp, n;

        // 1
        tmp = [];
        n = 'A = | > 1';
        tmp.push(criteriaGenerate(pat, n, 'A = 1', function (p) { return p.n[0] === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > 1', function (p) { return p.n[0] > 1; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 2
        tmp = [];
        n = 'A < | = | > 3';
        tmp.push(criteriaGenerate(pat, n, 'A = 3', function (p) { return p.n[0] === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > 3', function (p) { return p.n[0] > 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A < 3', function (p) { return p.n[0] < 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 3
        tmp = [];
        n = 'B < | = | > 3';
        tmp.push(criteriaGenerate(pat, n, 'B = 3', function (p) { return p.n[1] === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > 3', function (p) { return p.n[1] > 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < 3', function (p) { return p.n[1] < 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 4
        tmp = [];
        n = 'B < | = | > 4';
        tmp.push(criteriaGenerate(pat, n, 'B = 4', function (p) { return p.n[1] === 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > 4', function (p) { return p.n[1] > 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < 4', function (p) { return p.n[1] < 4; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 5
        tmp = [];
        n = 'A Even | Odd';
        tmp.push(criteriaGenerate(pat, n, 'A Even', function (p) { return p.n[0] % 2 === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A Odd', function (p) { return p.n[0] % 2 === 1; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 6
        tmp = [];
        n = 'B Even | Odd';
        tmp.push(criteriaGenerate(pat, n, 'B Even', function (p) { return p.n[1] % 2 === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B Odd', function (p) { return p.n[1] % 2 === 1; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 7
        tmp = [];
        n = 'C Even | Odd';
        tmp.push(criteriaGenerate(pat, n, 'C Even', function (p) { return p.n[2] % 2 === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C Odd', function (p) { return p.n[2] % 2 === 1; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 8
        tmp = [];
        n = '(0 1 2 3)x 1';
        tmp.push(criteriaGenerate(pat, n, '0x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 9
        tmp = [];
        n = '(0 1 2 3)x 3';
        tmp.push(criteriaGenerate(pat, n, '0x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 10
        tmp = [];
        n = '(0 1 2 3)x 4';
        tmp.push(criteriaGenerate(pat, n, '0x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 11
        tmp = [];
        n = 'A < | = | > B';
        tmp.push(criteriaGenerate(pat, n, 'A = B', function (p) { return p.n[0] === p.n[1]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > B', function (p) { return p.n[0] > p.n[1]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A < B', function (p) { return p.n[0] < p.n[1]; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 12
        tmp = [];
        n = 'A < | = | > C';
        tmp.push(criteriaGenerate(pat, n, 'A = C', function (p) { return p.n[0] === p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > C', function (p) { return p.n[0] > p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A < C', function (p) { return p.n[0] < p.n[2]; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 13
        tmp = [];
        n = 'B < | = | > C';
        tmp.push(criteriaGenerate(pat, n, 'B = C', function (p) { return p.n[1] === p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > C', function (p) { return p.n[1] > p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < C', function (p) { return p.n[1] < p.n[2]; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 14
        tmp = [];
        n = '(A < BC) | (B < AC) | (C < AB)';
        tmp.push(criteriaGenerate(pat, n, 'A < BC', function (p) { return (p.n[0] < p.n[1]) && (p.n[0] < p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < AC', function (p) { return (p.n[1] < p.n[0]) && (p.n[1] < p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C < AB', function (p) { return (p.n[2] < p.n[0]) && (p.n[2] < p.n[1]); }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 15
        tmp = [];
        n = '(A > BC) | (B > AC) | (C > AB)';
        tmp.push(criteriaGenerate(pat, n, 'A > BC', function (p) { return (p.n[0] > p.n[1]) && (p.n[0] > p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > AC', function (p) { return (p.n[1] > p.n[0]) && (p.n[1] > p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C > AB', function (p) { return (p.n[2] > p.n[0]) && (p.n[2] > p.n[1]); }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 16
        tmp = [];
        n = 'Even > | < Odd';
        tmp.push(criteriaGenerate(pat, n, 'Even > Odd', function (p) { return (p.n[0] % 2) + (p.n[1] % 2) + (p.n[2] % 2) < 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'Even < Odd', function (p) { return (p.n[0] % 2) + (p.n[1] % 2) + (p.n[2] % 2) >= 2; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 17
        tmp = [];
        n = '(0 1 2 3)x Even';
        tmp.push(criteriaGenerate(pat, n, '0x Even', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] % 2 === 0) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x Even', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] % 2 === 0) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x Even', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] % 2 === 0) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x Even', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] % 2 === 0) c++; return c === 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 18
        tmp = [];
        n = '(A + B + C) Even | Odd';
        tmp.push(criteriaGenerate(pat, n, 'A + B + C Even', function (p) { return (p.n[0] + p.n[1] + p.n[2]) % 2 === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A + B + C Odd', function (p) { return (p.n[0] + p.n[1] + p.n[2]) % 2 === 1; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 19
        tmp = [];
        n = '(A + B) < | = | > 6';
        tmp.push(criteriaGenerate(pat, n, 'A + B = 6', function (p) { return p.n[0] + p.n[1] === 6; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A + B > 6', function (p) { return p.n[0] + p.n[1] > 6; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A + B < 6', function (p) { return p.n[0] + p.n[1] < 6; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 0 });

        // 20
        tmp = [];
        n = '(0/1 2 3)x X';
        tmp.push(criteriaGenerate(pat, n, '0/1x X', function (p) { var c = [0, 0, 0, 0, 0]; for (var i = 0; i < 3; i++) c[p.n[i] - 1]++; return Math.max.apply(null, c) <= 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x X', function (p) { var c = [0, 0, 0, 0, 0]; for (var i = 0; i < 3; i++) c[p.n[i] - 1]++; return Math.max.apply(null, c) === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x X', function (p) { var c = [0, 0, 0, 0, 0]; for (var i = 0; i < 3; i++) c[p.n[i] - 1]++; return Math.max.apply(null, c) === 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 21
        tmp = [];
        n = 'X X Y Yes | No';
        tmp.push(criteriaGenerate(pat, n, 'X X Y Yes', function (p) { var c = [0, 0, 0, 0, 0]; for (var i = 0; i < 3; i++) c[p.n[i] - 1]++; return Math.max.apply(null, c) === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'X X Y No', function (p) { var c = [0, 0, 0, 0, 0]; for (var i = 0; i < 3; i++) c[p.n[i] - 1]++; return Math.max.apply(null, c) !== 2; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 22
        tmp = [];
        n = '(A < B < C) | (A > B > C) | (A ? B ? C)';
        tmp.push(criteriaGenerate(pat, n, 'A < B < C', function (p) { return (p.n[0] < p.n[1]) && (p.n[1] < p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > B > C', function (p) { return (p.n[0] > p.n[1]) && (p.n[1] > p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A ? B ? C', function (p) { return !(((p.n[0] < p.n[1]) && (p.n[1] < p.n[2])) || ((p.n[0] > p.n[1]) && (p.n[1] > p.n[2]))); }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 23
        tmp = [];
        n = '(A + B + C) < | = | > 6';
        tmp.push(criteriaGenerate(pat, n, 'A + B + C = 6', function (p) { return p.n[0] + p.n[1] + p.n[2] === 6; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A + B + C > 6', function (p) { return p.n[0] + p.n[1] + p.n[2] > 6; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A + B + C < 6', function (p) { return p.n[0] + p.n[1] + p.n[2] < 6; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 24
        tmp = [];
        n = '(0 2 3) Increment';
        tmp.push(criteriaGenerate(pat, n, '0 Increment', function (p) { return (p.n[1] - p.n[0] !== 1) && (p.n[2] - p.n[1] !== 1); }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2 Increment', function (p) { return (!(p.n[1] - p.n[0] !== 1)) !== (!(p.n[2] - p.n[1] !== 1)); }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3 Increment', function (p) { return (p.n[1] - p.n[0] === 1) && (p.n[2] - p.n[1] === 1); }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 25
        tmp = [];
        n = '(0 2 3) Increment/Decrement';
        tmp.push(criteriaGenerate(pat, n, '0 Increment/Decrement', function (p) { return ((p.n[1] - p.n[0] !== 1) && (p.n[2] - p.n[1] !== 1)) && ((p.n[1] - p.n[0] !== -1) && (p.n[2] - p.n[1] !== -1)); }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2 Increment/Decrement', function (p) { return ((!(p.n[1] - p.n[0] !== 1)) !== (!(p.n[2] - p.n[1] !== 1))) || ((!(p.n[1] - p.n[0] !== -1)) !== (!(p.n[2] - p.n[1] !== -1))); }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3 Increment/Decrement', function (p) { return ((p.n[1] - p.n[0] === 1) && (p.n[2] - p.n[1] === 1)) || ((p.n[1] - p.n[0] === -1) && (p.n[2] - p.n[1] === -1)); }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 26
        tmp = [];
        n = '(A | B | C) < 3';
        tmp.push(criteriaGenerate(pat, n, 'A < 3', function (p) { return p.n[0] < 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < 3', function (p) { return p.n[1] < 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C < 3', function (p) { return p.n[2] < 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 27
        tmp = [];
        n = '(A | B | C) < 4';
        tmp.push(criteriaGenerate(pat, n, 'A < 4', function (p) { return p.n[0] < 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < 4', function (p) { return p.n[1] < 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C < 4', function (p) { return p.n[2] < 4; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 28
        tmp = [];
        n = '(A | B | C) = 1';
        tmp.push(criteriaGenerate(pat, n, 'A = 1', function (p) { return p.n[0] === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B = 1', function (p) { return p.n[1] === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C = 1', function (p) { return p.n[2] === 1; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 29
        tmp = [];
        n = '(A | B | C) = 3';
        tmp.push(criteriaGenerate(pat, n, 'A = 3', function (p) { return p.n[0] === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B = 3', function (p) { return p.n[1] === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C = 3', function (p) { return p.n[2] === 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 30
        tmp = [];
        n = '(A | B | C) = 4';
        tmp.push(criteriaGenerate(pat, n, 'A = 4', function (p) { return p.n[0] === 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B = 4', function (p) { return p.n[1] === 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C = 4', function (p) { return p.n[2] === 4; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 31
        tmp = [];
        n = '(A | B | C) > 1';
        tmp.push(criteriaGenerate(pat, n, 'A > 1', function (p) { return p.n[0] > 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > 1', function (p) { return p.n[1] > 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C > 1', function (p) { return p.n[2] > 1; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 1 });

        // 32
        tmp = [];
        n = '(A | B | C) > 3';
        tmp.push(criteriaGenerate(pat, n, 'A > 3', function (p) { return p.n[0] > 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > 3', function (p) { return p.n[1] > 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C > 3', function (p) { return p.n[2] > 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 33
        tmp = [];
        n = '(A | B | C) Even | Odd';
        tmp.push(criteriaGenerate(pat, n, 'A Even', function (p) { return p.n[0] % 2 === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A Odd', function (p) { return p.n[0] % 2 === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B Even', function (p) { return p.n[1] % 2 === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B Odd', function (p) { return p.n[1] % 2 === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C Even', function (p) { return p.n[2] % 2 === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C Odd', function (p) { return p.n[2] % 2 === 1; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 34
        tmp = [];
        n = '(A <= BC) | (B <= AC) | (C <= AB)';
        tmp.push(criteriaGenerate(pat, n, 'A <= BC', function (p) { return (p.n[0] <= p.n[1]) && (p.n[0] <= p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B <= AC', function (p) { return (p.n[1] <= p.n[0]) && (p.n[1] <= p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C <= AB', function (p) { return (p.n[2] <= p.n[0]) && (p.n[2] <= p.n[1]); }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 35
        tmp = [];
        n = '(A >= BC) | (B >= AC) | (C >= AB)';
        tmp.push(criteriaGenerate(pat, n, 'A >= BC', function (p) { return (p.n[0] >= p.n[1]) && (p.n[0] >= p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B >= AC', function (p) { return (p.n[1] >= p.n[0]) && (p.n[1] >= p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C >= AB', function (p) { return (p.n[2] >= p.n[0]) && (p.n[2] >= p.n[1]); }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 36
        tmp = [];
        n = '(A + B + C) = 3x | 4x | 5x';
        tmp.push(criteriaGenerate(pat, n, 'A + B + C = 3x', function (p) { return (p.n[0] + p.n[1] + p.n[2]) % 3 === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A + B + C = 4x', function (p) { return (p.n[0] + p.n[1] + p.n[2]) % 4 === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A + B + C = 5x', function (p) { return (p.n[0] + p.n[1] + p.n[2]) % 5 === 0; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 37
        tmp = [];
        n = '(A + B) | (B + C) | (A + C) = 4';
        tmp.push(criteriaGenerate(pat, n, 'A + B = 4', function (p) { return p.n[0] + p.n[1] === 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B + C = 4', function (p) { return p.n[1] + p.n[2] === 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A + C = 4', function (p) { return p.n[0] + p.n[2] === 4; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 38
        tmp = [];
        n = '(A + B) | (B + C) | (A + C) = 6';
        tmp.push(criteriaGenerate(pat, n, 'A + B = 6', function (p) { return p.n[0] + p.n[1] === 6; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B + C = 6', function (p) { return p.n[1] + p.n[2] === 6; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A + C = 6', function (p) { return p.n[0] + p.n[2] === 6; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 39
        tmp = [];
        n = '(A | B | C) = | > 1';
        tmp.push(criteriaGenerate(pat, n, 'A = 1', function (p) { return p.n[0] === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > 1', function (p) { return p.n[0] > 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B = 1', function (p) { return p.n[1] === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > 1', function (p) { return p.n[1] > 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C = 1', function (p) { return p.n[2] === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C > 1', function (p) { return p.n[2] > 1; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 40
        tmp = [];
        n = '(A | B | C) < | = | > 3';
        tmp.push(criteriaGenerate(pat, n, 'A < 3', function (p) { return p.n[0] < 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A = 3', function (p) { return p.n[0] === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > 3', function (p) { return p.n[0] > 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < 3', function (p) { return p.n[1] < 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B = 3', function (p) { return p.n[1] === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > 3', function (p) { return p.n[1] > 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C < 3', function (p) { return p.n[2] < 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C = 3', function (p) { return p.n[2] === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C > 3', function (p) { return p.n[2] > 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 41
        tmp = [];
        n = '(A | B | C) < | = | > 4';
        tmp.push(criteriaGenerate(pat, n, 'A < 4', function (p) { return p.n[0] < 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A = 4', function (p) { return p.n[0] === 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > 4', function (p) { return p.n[0] > 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < 4', function (p) { return p.n[1] < 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B = 4', function (p) { return p.n[1] === 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > 4', function (p) { return p.n[1] > 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C < 4', function (p) { return p.n[2] < 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C = 4', function (p) { return p.n[2] === 4; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C > 4', function (p) { return p.n[2] > 4; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 42
        tmp = [];
        n = '(A < | > BC) | (B < | > AC) | (C < | > AB)';
        tmp.push(criteriaGenerate(pat, n, 'A < BC', function (p) { return (p.n[0] < p.n[1]) && (p.n[0] < p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < AC', function (p) { return (p.n[1] < p.n[0]) && (p.n[1] < p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C < AB', function (p) { return (p.n[2] < p.n[0]) && (p.n[2] < p.n[1]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > BC', function (p) { return (p.n[0] > p.n[1]) && (p.n[0] > p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > AC', function (p) { return (p.n[1] > p.n[0]) && (p.n[1] > p.n[2]); }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'C > AB', function (p) { return (p.n[2] > p.n[0]) && (p.n[2] > p.n[1]); }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 43
        tmp = [];
        n = 'A < | = | > (B | C)';
        tmp.push(criteriaGenerate(pat, n, 'A < B', function (p) { return p.n[0] < p.n[1]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A = B', function (p) { return p.n[0] === p.n[1]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > B', function (p) { return p.n[0] > p.n[1]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A < C', function (p) { return p.n[0] < p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A = C', function (p) { return p.n[0] === p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > C', function (p) { return p.n[0] > p.n[2]; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 44
        tmp = [];
        n = 'B < | = | > (A | C)';
        tmp.push(criteriaGenerate(pat, n, 'B < A', function (p) { return p.n[1] < p.n[0]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B = A', function (p) { return p.n[1] === p.n[0]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > A', function (p) { return p.n[1] > p.n[0]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < C', function (p) { return p.n[1] < p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B = C', function (p) { return p.n[1] === p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > C', function (p) { return p.n[1] > p.n[2]; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 45
        tmp = [];
        n = '(0 1 2 3)x 1 | 3';
        tmp.push(criteriaGenerate(pat, n, '0x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '0x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 46
        tmp = [];
        n = '(0 1 2 3)x 3 | 4';
        tmp.push(criteriaGenerate(pat, n, '0x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x 3', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 3) c++; return c === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '0x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 47
        tmp = [];
        n = '(0 1 2 3)x 1 | 4';
        tmp.push(criteriaGenerate(pat, n, '0x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x 1', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 1) c++; return c === 3; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '0x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 0; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '1x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 1; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '2x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 2; }, tmp));
        tmp.push(criteriaGenerate(pat, n, '3x 4', function (p) { var c = 0; for (var i = 0; i < p.n.length; i++) if (p.n[i] === 4) c++; return c === 3; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        // 48
        tmp = [];
        n = '(A | B | C) < | = | > (A | B | C)';
        tmp.push(criteriaGenerate(pat, n, 'A < B', function (p) { return p.n[0] < p.n[1]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A = B', function (p) { return p.n[0] === p.n[1]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > B', function (p) { return p.n[0] > p.n[1]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B < C', function (p) { return p.n[1] < p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B = C', function (p) { return p.n[1] === p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'B > C', function (p) { return p.n[1] > p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A < C', function (p) { return p.n[0] < p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A = C', function (p) { return p.n[0] === p.n[2]; }, tmp));
        tmp.push(criteriaGenerate(pat, n, 'A > C', function (p) { return p.n[0] > p.n[2]; }, tmp));
        cr.push({ name: n, cards: tmp, difficulty: 2 });

        return cr;
    }

    // ============================================================
    // Human-readable criterion labels
    // The raw " | " notation means OR: each verifier secretly picks
    // ONE of the alternatives as its answer. Display them clearly.
    // ============================================================

    function humanizeCriterion(n) {
        var loc = I18N[currentLang] && I18N[currentLang].criteria && I18N[currentLang].criteria[n];
        if (loc) return { display: loc.d, opts: loc.o || [] };
        var known = {
            'A = | > 1': { display: 'A vs 1', opts: ['= 1', '> 1'] },
            'A < | = | > 3': { display: 'A vs 3', opts: ['< 3', '= 3', '> 3'] },
            'B < | = | > 3': { display: 'B vs 3', opts: ['< 3', '= 3', '> 3'] },
            'B < | = | > 4': { display: 'B vs 4', opts: ['< 4', '= 4', '> 4'] },
            'A Even | Odd': { display: 'A parity', opts: ['Even', 'Odd'] },
            'B Even | Odd': { display: 'B parity', opts: ['Even', 'Odd'] },
            'C Even | Odd': { display: 'C parity', opts: ['Even', 'Odd'] },
            '(0 1 2 3)x 1': { display: 'Count of 1s', opts: ['0', '1', '2', '3'] },
            '(0 1 2 3)x 3': { display: 'Count of 3s', opts: ['0', '1', '2', '3'] },
            '(0 1 2 3)x 4': { display: 'Count of 4s', opts: ['0', '1', '2', '3'] },
            'A < | = | > B': { display: 'A vs B', opts: ['<', '=', '>'] },
            'A < | = | > C': { display: 'A vs C', opts: ['<', '=', '>'] },
            'B < | = | > C': { display: 'B vs C', opts: ['<', '=', '>'] },
            '(A < BC) | (B < AC) | (C < AB)': { display: 'Smallest digit', opts: ['A', 'B', 'C'] },
            '(A > BC) | (B > AC) | (C > AB)': { display: 'Largest digit', opts: ['A', 'B', 'C'] },
            'Even > | < Odd': { display: 'Evens vs odds', opts: ['More evens', 'More odds'] },
            '(0 1 2 3)x Even': { display: 'Count of evens', opts: ['0', '1', '2', '3'] },
            '(A + B + C) Even | Odd': { display: 'Sum parity', opts: ['Even', 'Odd'] },
            '(A + B) < | = | > 6': { display: 'A+B vs 6', opts: ['< 6', '= 6', '> 6'] },
            '(0/1 2 3)x X': { display: 'Repeated digits', opts: ['None', 'One pair', 'Triple'] },
            'X X Y Yes | No': { display: 'Has one pair?', opts: ['Yes', 'No'] },
            '(A < B < C) | (A > B > C) | (A ? B ? C)': { display: 'A,B,C order', opts: ['Ascending', 'Descending', 'Neither'] },
            '(A + B + C) < | = | > 6': { display: 'Sum vs 6', opts: ['< 6', '= 6', '> 6'] },
            '(0 2 3) Increment': { display: 'Steps of +1', opts: ['None', 'One', 'All'] },
            '(0 2 3) Increment/Decrement': { display: 'Steps of ±1', opts: ['None', 'One', 'All'] },
            '(A | B | C) < 3': { display: 'Which is < 3?', opts: ['A', 'B', 'C'] },
            '(A | B | C) < 4': { display: 'Which is < 4?', opts: ['A', 'B', 'C'] },
            '(A | B | C) = 1': { display: 'Which is = 1?', opts: ['A', 'B', 'C'] },
            '(A | B | C) = 3': { display: 'Which is = 3?', opts: ['A', 'B', 'C'] },
            '(A | B | C) = 4': { display: 'Which is = 4?', opts: ['A', 'B', 'C'] },
            '(A | B | C) > 1': { display: 'Which is > 1?', opts: ['A', 'B', 'C'] },
            '(A | B | C) > 3': { display: 'Which is > 3?', opts: ['A', 'B', 'C'] },
            '(A | B | C) Even | Odd': { display: 'Which is even/odd?', opts: ['A even', 'A odd', 'B even', 'B odd', 'C even', 'C odd'] },
            '(A <= BC) | (B <= AC) | (C <= AB)': { display: 'Smallest (ties ok)', opts: ['A', 'B', 'C'] },
            '(A >= BC) | (B >= AC) | (C >= AB)': { display: 'Largest (ties ok)', opts: ['A', 'B', 'C'] },
            '(A + B + C) = 3x | 4x | 5x': { display: 'Sum is multiple of', opts: ['3', '4', '5'] },
            '(A + B) | (B + C) | (A + C) = 4': { display: 'Pair sums to 4', opts: ['A+B', 'B+C', 'A+C'] },
            '(A + B) | (B + C) | (A + C) = 6': { display: 'Pair sums to 6', opts: ['A+B', 'B+C', 'A+C'] },
            '(A | B | C) = | > 1': { display: 'Which is 1 or > 1?', opts: ['A', 'B', 'C'] },
            '(A | B | C) < | = | > 3': { display: 'Which slot vs 3?', opts: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
            '(A | B | C) < | = | > 4': { display: 'Which slot vs 4?', opts: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
            '(A < | > BC) | (B < | > AC) | (C < | > AB)': { display: 'Smallest or largest?', opts: ['A min', 'B min', 'C min', 'A max', 'B max', 'C max'] },
            'A < | = | > (B | C)': { display: 'A vs B or C', opts: ['A<B', 'A=B', 'A>B', 'A<C', 'A=C', 'A>C'] },
            'B < | = | > (A | C)': { display: 'B vs A or C', opts: ['B<A', 'B=A', 'B>A', 'B<C', 'B=C', 'B>C'] },
            '(0 1 2 3)x 1 | 3': { display: 'Count of 1s or 3s', opts: ['1s: 0-3', '3s: 0-3'] },
            '(0 1 2 3)x 3 | 4': { display: 'Count of 3s or 4s', opts: ['3s: 0-3', '4s: 0-3'] },
            '(0 1 2 3)x 1 | 4': { display: 'Count of 1s or 4s', opts: ['1s: 0-3', '4s: 0-3'] },
            '(A | B | C) < | = | > (A | B | C)': { display: 'A, B, C comparisons', opts: ['A<B', 'A=B', 'A>B', 'B<C', 'B=C', 'B>C', 'A<C', 'A=C', 'A>C'] }
        };
        var h = known[n];
        if (h) return h;
        // Fallback: just replace the pipes with "or"
        return { display: n.split(' | ').join(' or '), opts: [] };
    }

    // ============================================================
    // Detailed verifier explanations (pedagogical, NO answer hints)
    // ============================================================
    var criteriaExplainBase = {
        en: {
            'A = | > 1': "Compares digit A against 1: it tells you whether A is exactly 1 or greater than 1.",
            'A < | = | > 3': "Compares digit A against 3: less than, equal to, or greater than 3.",
            'B < | = | > 3': "Compares digit B against 3: less than, equal to, or greater than 3.",
            'B < | = | > 4': "Compares digit B against 4: less than, equal to, or greater than 4.",
            'A Even | Odd': "Tells you whether digit A is even (2 or 4) or odd (1, 3 or 5).",
            'B Even | Odd': "Tells you whether digit B is even (2 or 4) or odd (1, 3 or 5).",
            'C Even | Odd': "Tells you whether digit C is even (2 or 4) or odd (1, 3 or 5).",
            '(0 1 2 3)x 1': "Counts how many times digit 1 appears in the whole code: 0, 1, 2 or 3 times.",
            '(0 1 2 3)x 3': "Counts how many times digit 3 appears in the whole code: 0, 1, 2 or 3 times.",
            '(0 1 2 3)x 4': "Counts how many times digit 4 appears in the whole code: 0, 1, 2 or 3 times.",
            'A < | = | > B': "Compares A and B: whether A is less than, equal to, or greater than B.",
            'A < | = | > C': "Compares A and C: whether A is less than, equal to, or greater than C.",
            'B < | = | > C': "Compares B and C: whether B is less than, equal to, or greater than C.",
            '(A < BC) | (B < AC) | (C < AB)': "Tells you which digit is the smallest. A is chosen when A is smaller than both B and C, etc.",
            '(A > BC) | (B > AC) | (C > AB)': "Tells you which digit is the largest. A is chosen when A is greater than both B and C, etc.",
            'Even > | < Odd': "Compares how many even digits the code has against how many odd digits: more evens or more odds.",
            '(0 1 2 3)x Even': "Counts how many of the 3 digits are even (2 or 4): 0, 1, 2 or 3.",
            '(A + B + C) Even | Odd': "Adds all three digits and tells you whether the total is even or odd.",
            '(A + B) < | = | > 6': "Adds A and B and compares the result against 6: less than, equal to, or greater than 6.",
            '(0/1 2 3)x X': "Looks at repeated digits: no digit repeats, exactly one pair of equal digits, or three equal digits.",
            'X X Y Yes | No': "Asks whether the code has EXACTLY one pair of equal digits: yes or no.",
            '(A < B < C) | (A > B > C) | (A ? B ? C)': "Checks the order of the digits: strictly ascending, strictly descending, or neither.",
            '(A + B + C) < | = | > 6': "Adds all three digits and compares the total against 6.",
            '(0 2 3) Increment': "Checks +1 steps between consecutive digits (B = A+1 and/or C = B+1): none, exactly one, or both.",
            '(0 2 3) Increment/Decrement': "Checks steps of +1 or -1 between consecutive digits: none, exactly one, or both.",
            '(A | B | C) < 3': "Tells you which digit (A, B or C) is the one that is less than 3.",
            '(A | B | C) < 4': "Tells you which digit (A, B or C) is the one that is less than 4.",
            '(A | B | C) = 1': "Tells you which digit (A, B or C) is exactly 1.",
            '(A | B | C) = 3': "Tells you which digit (A, B or C) is exactly 3.",
            '(A | B | C) = 4': "Tells you which digit (A, B or C) is exactly 4.",
            '(A | B | C) > 1': "Tells you which digit (A, B or C) is greater than 1.",
            '(A | B | C) > 3': "Tells you which digit (A, B or C) is greater than 3.",
            '(A | B | C) Even | Odd': "Names one digit and tells you whether that digit is even or odd (e.g. 'A is even').",
            '(A <= BC) | (B <= AC) | (C <= AB)': "Tells you which digit is the smallest, counting ties: A when A ≤ B and A ≤ C, etc.",
            '(A >= BC) | (B >= AC) | (C >= AB)': "Tells you which digit is the largest, counting ties: A when A ≥ B and A ≥ C, etc.",
            '(A + B + C) = 3x | 4x | 5x': "Adds all three digits and tells you whether the total is a multiple of 3, 4 or 5.",
            '(A + B) | (B + C) | (A + C) = 4': "Adds pairs of digits: tells you which pair (A+B, B+C or A+C) sums to exactly 4.",
            '(A + B) | (B + C) | (A + C) = 6': "Adds pairs of digits: tells you which pair (A+B, B+C or A+C) sums to exactly 6.",
            '(A | B | C) = | > 1': "Names a digit and tells you whether that digit is exactly 1 or greater than 1.",
            '(A | B | C) < | = | > 3': "Names a digit and tells you whether that digit is less than, equal to, or greater than 3.",
            '(A | B | C) < | = | > 4': "Names a digit and tells you whether that digit is less than, equal to, or greater than 4.",
            '(A < | > BC) | (B < | > AC) | (C < | > AB)': "Tells you which digit is the smallest OR which is the largest: it names a digit and says if it is the min or the max.",
            'A < | = | > (B | C)': "Compares A against B or C: it names the other digit and gives the comparison (<, = or >).",
            'B < | = | > (A | C)': "Compares B against A or C: it names the other digit and gives the comparison (<, = or >).",
            '(0 1 2 3)x 1 | 3': "Tells you which digit it is counting (1s or 3s) and how many times that digit appears (0-3).",
            '(0 1 2 3)x 3 | 4': "Tells you which digit it is counting (3s or 4s) and how many times that digit appears (0-3).",
            '(0 1 2 3)x 1 | 4': "Tells you which digit it is counting (1s or 4s) and how many times that digit appears (0-3).",
            '(A | B | C) < | = | > (A | B | C)': "Compares two of the three digits: it names the pair (A-B, B-C or A-C) and gives the comparison (<, = or >)."
        },
        es: {
            'A = | > 1': "Compara el dígito A contra 1: te dice si A es exactamente 1 o si es mayor que 1.",
            'A < | = | > 3': "Compara el dígito A contra 3: menor, igual o mayor que 3.",
            'B < | = | > 3': "Compara el dígito B contra 3: menor, igual o mayor que 3.",
            'B < | = | > 4': "Compara el dígito B contra 4: menor, igual o mayor que 4.",
            'A Even | Odd': "Te dice si el dígito A es par (2 o 4) o impar (1, 3 o 5).",
            'B Even | Odd': "Te dice si el dígito B es par (2 o 4) o impar (1, 3 o 5).",
            'C Even | Odd': "Te dice si el dígito C es par (2 o 4) o impar (1, 3 o 5).",
            '(0 1 2 3)x 1': "Cuenta cuántas veces aparece el dígito 1 en todo el código: 0, 1, 2 o 3 veces.",
            '(0 1 2 3)x 3': "Cuenta cuántas veces aparece el dígito 3 en todo el código: 0, 1, 2 o 3 veces.",
            '(0 1 2 3)x 4': "Cuenta cuántas veces aparece el dígito 4 en todo el código: 0, 1, 2 o 3 veces.",
            'A < | = | > B': "Compara A con B: si A es menor, igual o mayor que B.",
            'A < | = | > C': "Compara A con C: si A es menor, igual o mayor que C.",
            'B < | = | > C': "Compara B con C: si B es menor, igual o mayor que C.",
            '(A < BC) | (B < AC) | (C < AB)': "Te dice cuál dígito es el menor. A cuando A es menor que B y C a la vez, etc.",
            '(A > BC) | (B > AC) | (C > AB)': "Te dice cuál dígito es el mayor. A cuando A es mayor que B y C a la vez, etc.",
            'Even > | < Odd': "Compara cuántos dígitos pares tiene el código contra cuántos impares: más pares o más impares.",
            '(0 1 2 3)x Even': "Cuenta cuántos de los 3 dígitos son pares (2 o 4): 0, 1, 2 o 3.",
            '(A + B + C) Even | Odd': "Suma los tres dígitos y te dice si el total es par o impar.",
            '(A + B) < | = | > 6': "Suma A y B y compara el resultado contra 6: menor, igual o mayor que 6.",
            '(0/1 2 3)x X': "Mira los dígitos repetidos: ninguno se repite, hay exactamente un par igual, o tres iguales.",
            'X X Y Yes | No': "Pregunta si el código tiene EXACTAMENTE un par de dígitos iguales: sí o no.",
            '(A < B < C) | (A > B > C) | (A ? B ? C)': "Revisa el orden de los dígitos: ascendente estricto, descendente estricto, o ninguno.",
            '(A + B + C) < | = | > 6': "Suma los tres dígitos y compara el total contra 6.",
            '(0 2 3) Increment': "Revisa pasos de +1 entre dígitos consecutivos (B = A+1 y/o C = B+1): ninguno, uno o ambos.",
            '(0 2 3) Increment/Decrement': "Revisa pasos de +1 o -1 entre dígitos consecutivos: ninguno, uno o ambos.",
            '(A | B | C) < 3': "Te dice cuál dígito (A, B o C) es el que es menor que 3.",
            '(A | B | C) < 4': "Te dice cuál dígito (A, B o C) es el que es menor que 4.",
            '(A | B | C) = 1': "Te dice cuál dígito (A, B o C) es exactamente 1.",
            '(A | B | C) = 3': "Te dice cuál dígito (A, B o C) es exactamente 3.",
            '(A | B | C) = 4': "Te dice cuál dígito (A, B o C) es exactamente 4.",
            '(A | B | C) > 1': "Te dice cuál dígito (A, B o C) es mayor que 1.",
            '(A | B | C) > 3': "Te dice cuál dígito (A, B o C) es mayor que 3.",
            '(A | B | C) Even | Odd': "Nombra un dígito y te dice si ese dígito es par o impar (ej.: 'A es par').",
            '(A <= BC) | (B <= AC) | (C <= AB)': "Te dice cuál dígito es el menor, contando empates: A cuando A ≤ B y A ≤ C, etc.",
            '(A >= BC) | (B >= AC) | (C >= AB)': "Te dice cuál dígito es el mayor, contando empates: A cuando A ≥ B y A ≥ C, etc.",
            '(A + B + C) = 3x | 4x | 5x': "Suma los tres dígitos y te dice si el total es múltiplo de 3, 4 o 5.",
            '(A + B) | (B + C) | (A + C) = 4': "Suma pares de dígitos: te dice cuál par (A+B, B+C o A+C) da exactamente 4.",
            '(A + B) | (B + C) | (A + C) = 6': "Suma pares de dígitos: te dice cuál par (A+B, B+C o A+C) da exactamente 6.",
            '(A | B | C) = | > 1': "Nombra un dígito y te dice si ese dígito es exactamente 1 o mayor que 1.",
            '(A | B | C) < | = | > 3': "Nombra un dígito y te dice si ese dígito es menor, igual o mayor que 3.",
            '(A | B | C) < | = | > 4': "Nombra un dígito y te dice si ese dígito es menor, igual o mayor que 4.",
            '(A < | > BC) | (B < | > AC) | (C < | > AB)': "Te dice cuál dígito es el menor O cuál es el mayor: nombra un dígito y dice si es el mín o el máx.",
            'A < | = | > (B | C)': "Compara A contra B o C: nombra el otro dígito y da la comparación (<, = o >).",
            'B < | = | > (A | C)': "Compara B contra A o C: nombra el otro dígito y da la comparación (<, = o >).",
            '(0 1 2 3)x 1 | 3': "Te dice qué dígito está contando (1 o 3) y cuántas veces aparece ese dígito (0-3).",
            '(0 1 2 3)x 3 | 4': "Te dice qué dígito está contando (3 o 4) y cuántas veces aparece ese dígito (0-3).",
            '(0 1 2 3)x 1 | 4': "Te dice qué dígito está contando (1 o 4) y cuántas veces aparece ese dígito (0-3).",
            '(A | B | C) < | = | > (A | B | C)': "Compara dos de los tres dígitos: nombra el par (A-B, B-C o A-C) y da la comparación (<, = o >)."
        },
        fr: {
            'A = | > 1': "Compare le chiffre A à 1 : vous dit si A vaut exactement 1 ou s'il est supérieur à 1.",
            'A < | = | > 3': "Compare le chiffre A à 3 : inférieur, égal ou supérieur à 3.",
            'B < | = | > 3': "Compare le chiffre B à 3 : inférieur, égal ou supérieur à 3.",
            'B < | = | > 4': "Compare le chiffre B à 4 : inférieur, égal ou supérieur à 4.",
            'A Even | Odd': "Vous dit si le chiffre A est pair (2 ou 4) ou impair (1, 3 ou 5).",
            'B Even | Odd': "Vous dit si le chiffre B est pair (2 ou 4) ou impair (1, 3 ou 5).",
            'C Even | Odd': "Vous dit si le chiffre C est pair (2 ou 4) ou impair (1, 3 ou 5).",
            '(0 1 2 3)x 1': "Compte combien de fois le chiffre 1 apparaît dans tout le code : 0, 1, 2 ou 3 fois.",
            '(0 1 2 3)x 3': "Compte combien de fois le chiffre 3 apparaît dans tout le code : 0, 1, 2 ou 3 fois.",
            '(0 1 2 3)x 4': "Compte combien de fois le chiffre 4 apparaît dans tout le code : 0, 1, 2 ou 3 fois.",
            'A < | = | > B': "Compare A et B : si A est inférieur, égal ou supérieur à B.",
            'A < | = | > C': "Compare A et C : si A est inférieur, égal ou supérieur à C.",
            'B < | = | > C': "Compare B et C : si B est inférieur, égal ou supérieur à C.",
            '(A < BC) | (B < AC) | (C < AB)': "Vous dit quel chiffre est le plus petit. A est choisi quand A est plus petit que B et C à la fois, etc.",
            '(A > BC) | (B > AC) | (C > AB)': "Vous dit quel chiffre est le plus grand. A est choisi quand A est plus grand que B et C à la fois, etc.",
            'Even > | < Odd': "Compare combien de chiffres pairs contient le code par rapport aux impairs : plus de pairs ou plus d'impairs.",
            '(0 1 2 3)x Even': "Compte combien des 3 chiffres sont pairs (2 ou 4) : 0, 1, 2 ou 3.",
            '(A + B + C) Even | Odd': "Additionne les trois chiffres et vous dit si le total est pair ou impair.",
            '(A + B) < | = | > 6': "Additionne A et B et compare le résultat à 6 : inférieur, égal ou supérieur à 6.",
            '(0/1 2 3)x X': "Regarde les chiffres répétés : aucun chiffre ne se répète, exactement une paire identique, ou trois chiffres identiques.",
            'X X Y Yes | No': "Demande si le code contient EXACTEMENT une paire de chiffres identiques : oui ou non.",
            '(A < B < C) | (A > B > C) | (A ? B ? C)': "Vérifie l'ordre des chiffres : strictement croissant, strictement décroissant, ou aucun des deux.",
            '(A + B + C) < | = | > 6': "Additionne les trois chiffres et compare le total à 6.",
            '(0 2 3) Increment': "Vérifie les étapes de +1 entre chiffres consécutifs (B = A+1 et/ou C = B+1) : aucune, une ou les deux.",
            '(0 2 3) Increment/Decrement': "Vérifie les étapes de +1 ou -1 entre chiffres consécutifs : aucune, une ou les deux.",
            '(A | B | C) < 3': "Vous dit quel chiffre (A, B ou C) est celui qui est inférieur à 3.",
            '(A | B | C) < 4': "Vous dit quel chiffre (A, B ou C) est celui qui est inférieur à 4.",
            '(A | B | C) = 1': "Vous dit quel chiffre (A, B ou C) vaut exactement 1.",
            '(A | B | C) = 3': "Vous dit quel chiffre (A, B ou C) vaut exactement 3.",
            '(A | B | C) = 4': "Vous dit quel chiffre (A, B ou C) vaut exactement 4.",
            '(A | B | C) > 1': "Vous dit quel chiffre (A, B ou C) est supérieur à 1.",
            '(A | B | C) > 3': "Vous dit quel chiffre (A, B ou C) est supérieur à 3.",
            '(A | B | C) Even | Odd': "Nomme un chiffre et vous dit si ce chiffre est pair ou impair (ex. : « A est pair »).",
            '(A <= BC) | (B <= AC) | (C <= AB)': "Vous dit quel chiffre est le plus petit, égalités comprises : A quand A ≤ B et A ≤ C, etc.",
            '(A >= BC) | (B >= AC) | (C >= AB)': "Vous dit quel chiffre est le plus grand, égalités comprises : A quand A ≥ B et A ≥ C, etc.",
            '(A + B + C) = 3x | 4x | 5x': "Additionne les trois chiffres et vous dit si le total est un multiple de 3, 4 ou 5.",
            '(A + B) | (B + C) | (A + C) = 4': "Additionne des paires de chiffres : vous dit quelle paire (A+B, B+C ou A+C) donne exactement 4.",
            '(A + B) | (B + C) | (A + C) = 6': "Additionne des paires de chiffres : vous dit quelle paire (A+B, B+C ou A+C) donne exactement 6.",
            '(A | B | C) = | > 1': "Nomme un chiffre et vous dit si ce chiffre vaut exactement 1 ou s'il est supérieur à 1.",
            '(A | B | C) < | = | > 3': "Nomme un chiffre et vous dit si ce chiffre est inférieur, égal ou supérieur à 3.",
            '(A | B | C) < | = | > 4': "Nomme un chiffre et vous dit si ce chiffre est inférieur, égal ou supérieur à 4.",
            '(A < | > BC) | (B < | > AC) | (C < | > AB)': "Vous dit quel chiffre est le plus petit OU lequel est le plus grand : il nomme un chiffre et dit s'il est le min ou le max.",
            'A < | = | > (B | C)': "Compare A à B ou C : il nomme l'autre chiffre et donne la comparaison (<, = ou >).",
            'B < | = | > (A | C)': "Compare B à A ou C : il nomme l'autre chiffre et donne la comparaison (<, = ou >).",
            '(0 1 2 3)x 1 | 3': "Vous dit quel chiffre il compte (les 1 ou les 3) et combien de fois ce chiffre apparaît (0-3).",
            '(0 1 2 3)x 3 | 4': "Vous dit quel chiffre il compte (les 3 ou les 4) et combien de fois ce chiffre apparaît (0-3).",
            '(0 1 2 3)x 1 | 4': "Vous dit quel chiffre il compte (les 1 ou les 4) et combien de fois ce chiffre apparaît (0-3).",
            '(A | B | C) < | = | > (A | B | C)': "Compare deux des trois chiffres : il nomme la paire (A-B, B-C ou A-C) et donne la comparaison (<, = ou >)."
        },
        de: {
            'A = | > 1': "Vergleicht Ziffer A mit 1: sagt dir, ob A genau 1 oder größer als 1 ist.",
            'A < | = | > 3': "Vergleicht Ziffer A mit 3: kleiner, gleich oder größer als 3.",
            'B < | = | > 3': "Vergleicht Ziffer B mit 3: kleiner, gleich oder größer als 3.",
            'B < | = | > 4': "Vergleicht Ziffer B mit 4: kleiner, gleich oder größer als 4.",
            'A Even | Odd': "Sagt dir, ob Ziffer A gerade (2 oder 4) oder ungerade (1, 3 oder 5) ist.",
            'B Even | Odd': "Sagt dir, ob Ziffer B gerade (2 oder 4) oder ungerade (1, 3 oder 5) ist.",
            'C Even | Odd': "Sagt dir, ob Ziffer C gerade (2 oder 4) oder ungerade (1, 3 oder 5) ist.",
            '(0 1 2 3)x 1': "Zählt, wie oft die Ziffer 1 im gesamten Code vorkommt: 0, 1, 2 oder 3 Mal.",
            '(0 1 2 3)x 3': "Zählt, wie oft die Ziffer 3 im gesamten Code vorkommt: 0, 1, 2 oder 3 Mal.",
            '(0 1 2 3)x 4': "Zählt, wie oft die Ziffer 4 im gesamten Code vorkommt: 0, 1, 2 oder 3 Mal.",
            'A < | = | > B': "Vergleicht A und B: ob A kleiner, gleich oder größer als B ist.",
            'A < | = | > C': "Vergleicht A und C: ob A kleiner, gleich oder größer als C ist.",
            'B < | = | > C': "Vergleicht B und C: ob B kleiner, gleich oder größer als C ist.",
            '(A < BC) | (B < AC) | (C < AB)': "Sagt dir, welche Ziffer die kleinste ist. A wird gewählt, wenn A kleiner als B und C ist usw.",
            '(A > BC) | (B > AC) | (C > AB)': "Sagt dir, welche Ziffer die größte ist. A wird gewählt, wenn A größer als B und C ist usw.",
            'Even > | < Odd': "Vergleicht, wie viele gerade Ziffern der Code hat, mit den ungeraden: mehr gerade oder mehr ungerade.",
            '(0 1 2 3)x Even': "Zählt, wie viele der 3 Ziffern gerade sind (2 oder 4): 0, 1, 2 oder 3.",
            '(A + B + C) Even | Odd': "Addiert alle drei Ziffern und sagt dir, ob die Summe gerade oder ungerade ist.",
            '(A + B) < | = | > 6': "Addiert A und B und vergleicht das Ergebnis mit 6: kleiner, gleich oder größer als 6.",
            '(0/1 2 3)x X': "Prüft wiederholte Ziffern: keine Ziffer wiederholt sich, genau ein Paar gleicher Ziffern, oder drei gleiche Ziffern.",
            'X X Y Yes | No': "Fragt, ob der Code GENAU EIN Paar gleicher Ziffern hat: ja oder nein.",
            '(A < B < C) | (A > B > C) | (A ? B ? C)': "Prüft die Reihenfolge der Ziffern: streng aufsteigend, streng absteigend oder keines von beidem.",
            '(A + B + C) < | = | > 6': "Addiert alle drei Ziffern und vergleicht die Summe mit 6.",
            '(0 2 3) Increment': "Prüft +1-Schritte zwischen aufeinanderfolgenden Ziffern (B = A+1 und/oder C = B+1): keiner, genau einer oder beide.",
            '(0 2 3) Increment/Decrement': "Prüft Schritte von +1 oder -1 zwischen aufeinanderfolgenden Ziffern: keiner, genau einer oder beide.",
            '(A | B | C) < 3': "Sagt dir, welche Ziffer (A, B oder C) diejenige ist, die kleiner als 3 ist.",
            '(A | B | C) < 4': "Sagt dir, welche Ziffer (A, B oder C) diejenige ist, die kleiner als 4 ist.",
            '(A | B | C) = 1': "Sagt dir, welche Ziffer (A, B oder C) genau 1 ist.",
            '(A | B | C) = 3': "Sagt dir, welche Ziffer (A, B oder C) genau 3 ist.",
            '(A | B | C) = 4': "Sagt dir, welche Ziffer (A, B oder C) genau 4 ist.",
            '(A | B | C) > 1': "Sagt dir, welche Ziffer (A, B oder C) größer als 1 ist.",
            '(A | B | C) > 3': "Sagt dir, welche Ziffer (A, B oder C) größer als 3 ist.",
            '(A | B | C) Even | Odd': "Nennt eine Ziffer und sagt dir, ob diese Ziffer gerade oder ungerade ist (z. B. ‚A ist gerade').",
            '(A <= BC) | (B <= AC) | (C <= AB)': "Sagt dir, welche Ziffer die kleinste ist, Gleichstände eingeschlossen: A, wenn A ≤ B und A ≤ C usw.",
            '(A >= BC) | (B >= AC) | (C >= AB)': "Sagt dir, welche Ziffer die größte ist, Gleichstände eingeschlossen: A, wenn A ≥ B und A ≥ C usw.",
            '(A + B + C) = 3x | 4x | 5x': "Addiert alle drei Ziffern und sagt dir, ob die Summe ein Vielfaches von 3, 4 oder 5 ist.",
            '(A + B) | (B + C) | (A + C) = 4': "Addiert Ziffernpaare: sagt dir, welches Paar (A+B, B+C oder A+C) genau 4 ergibt.",
            '(A + B) | (B + C) | (A + C) = 6': "Addiert Ziffernpaare: sagt dir, welches Paar (A+B, B+C oder A+C) genau 6 ergibt.",
            '(A | B | C) = | > 1': "Nennt eine Ziffer und sagt dir, ob diese Ziffer genau 1 oder größer als 1 ist.",
            '(A | B | C) < | = | > 3': "Nennt eine Ziffer und sagt dir, ob diese Ziffer kleiner, gleich oder größer als 3 ist.",
            '(A | B | C) < | = | > 4': "Nennt eine Ziffer und sagt dir, ob diese Ziffer kleiner, gleich oder größer als 4 ist.",
            '(A < | > BC) | (B < | > AC) | (C < | > AB)': "Sagt dir, welche Ziffer die kleinste ODER welche die größte ist: er nennt eine Ziffer und sagt, ob sie das Min oder das Max ist.",
            'A < | = | > (B | C)': "Vergleicht A mit B oder C: er nennt die andere Ziffer und gibt den Vergleich (<, = oder >) an.",
            'B < | = | > (A | C)': "Vergleicht B mit A oder C: er nennt die andere Ziffer und gibt den Vergleich (<, = oder >) an.",
            '(0 1 2 3)x 1 | 3': "Sagt dir, welche Ziffer gezählt wird (1er oder 3er) und wie oft diese Ziffer vorkommt (0-3).",
            '(0 1 2 3)x 3 | 4': "Sagt dir, welche Ziffer gezählt wird (3er oder 4er) und wie oft diese Ziffer vorkommt (0-3).",
            '(0 1 2 3)x 1 | 4': "Sagt dir, welche Ziffer gezählt wird (1er oder 4er) und wie oft diese Ziffer vorkommt (0-3).",
            '(A | B | C) < | = | > (A | B | C)': "Vergleicht zwei der drei Ziffern: er nennt das Paar (A-B, B-C oder A-C) und gibt den Vergleich (<, = oder >) an."
        },
        ru: {
            'A = | > 1': "Сравнивает цифру A с 1: говорит, равна ли A ровно 1 или больше 1.",
            'A < | = | > 3': "Сравнивает цифру A с 3: меньше, равна или больше 3.",
            'B < | = | > 3': "Сравнивает цифру B с 3: меньше, равна или больше 3.",
            'B < | = | > 4': "Сравнивает цифру B с 4: меньше, равна или больше 4.",
            'A Even | Odd': "Говорит, чётная ли цифра A (2 или 4) или нечётная (1, 3 или 5).",
            'B Even | Odd': "Говорит, чётная ли цифра B (2 или 4) или нечётная (1, 3 или 5).",
            'C Even | Odd': "Говорит, чётная ли цифра C (2 или 4) или нечётная (1, 3 или 5).",
            '(0 1 2 3)x 1': "Считает, сколько раз цифра 1 встречается во всём коде: 0, 1, 2 или 3 раза.",
            '(0 1 2 3)x 3': "Считает, сколько раз цифра 3 встречается во всём коде: 0, 1, 2 или 3 раза.",
            '(0 1 2 3)x 4': "Считает, сколько раз цифра 4 встречается во всём коде: 0, 1, 2 или 3 раза.",
            'A < | = | > B': "Сравнивает A и B: меньше ли A, равна или больше B.",
            'A < | = | > C': "Сравнивает A и C: меньше ли A, равна или больше C.",
            'B < | = | > C': "Сравнивает B и C: меньше ли B, равна или больше C.",
            '(A < BC) | (B < AC) | (C < AB)': "Говорит, какая цифра наименьшая. A выбирается, когда A меньше и B, и C, и т. д.",
            '(A > BC) | (B > AC) | (C > AB)': "Говорит, какая цифра наибольшая. A выбирается, когда A больше и B, и C, и т. д.",
            'Even > | < Odd': "Сравнивает, сколько в коде чётных цифр и сколько нечётных: больше чётных или больше нечётных.",
            '(0 1 2 3)x Even': "Считает, сколько из 3 цифр чётные (2 или 4): 0, 1, 2 или 3.",
            '(A + B + C) Even | Odd': "Складывает все три цифры и говорит, чётная сумма или нечётная.",
            '(A + B) < | = | > 6': "Складывает A и B и сравнивает результат с 6: меньше, равен или больше 6.",
            '(0/1 2 3)x X': "Смотрит на повторяющиеся цифры: ни одна цифра не повторяется, ровно одна пара одинаковых, или три одинаковые.",
            'X X Y Yes | No': "Спрашивает, есть ли в коде РОВНО одна пара одинаковых цифр: да или нет.",
            '(A < B < C) | (A > B > C) | (A ? B ? C)': "Проверяет порядок цифр: строго возрастающий, строго убывающий или ни тот, ни другой.",
            '(A + B + C) < | = | > 6': "Складывает все три цифры и сравнивает сумму с 6.",
            '(0 2 3) Increment': "Проверяет шаги +1 между соседними цифрами (B = A+1 и/или C = B+1): ни одного, ровно один или оба.",
            '(0 2 3) Increment/Decrement': "Проверяет шаги +1 или -1 между соседними цифрами: ни одного, ровно один или оба.",
            '(A | B | C) < 3': "Говорит, какая цифра (A, B или C) меньше 3.",
            '(A | B | C) < 4': "Говорит, какая цифра (A, B или C) меньше 4.",
            '(A | B | C) = 1': "Говорит, какая цифра (A, B или C) ровно равна 1.",
            '(A | B | C) = 3': "Говорит, какая цифра (A, B или C) ровно равна 3.",
            '(A | B | C) = 4': "Говорит, какая цифра (A, B или C) ровно равна 4.",
            '(A | B | C) > 1': "Говорит, какая цифра (A, B или C) больше 1.",
            '(A | B | C) > 3': "Говорит, какая цифра (A, B или C) больше 3.",
            '(A | B | C) Even | Odd': "Называет одну цифру и говорит, чётная она или нечётная (например: «A — чётная»).",
            '(A <= BC) | (B <= AC) | (C <= AB)': "Говорит, какая цифра наименьшая, с учётом равенств: A, когда A ≤ B и A ≤ C, и т. д.",
            '(A >= BC) | (B >= AC) | (C >= AB)': "Говорит, какая цифра наибольшая, с учётом равенств: A, когда A ≥ B и A ≥ C, и т. д.",
            '(A + B + C) = 3x | 4x | 5x': "Складывает все три цифры и говорит, кратно ли общее число 3, 4 или 5.",
            '(A + B) | (B + C) | (A + C) = 4': "Складывает пары цифр: говорит, какая пара (A+B, B+C или A+C) даёт ровно 4.",
            '(A + B) | (B + C) | (A + C) = 6': "Складывает пары цифр: говорит, какая пара (A+B, B+C или A+C) даёт ровно 6.",
            '(A | B | C) = | > 1': "Называет одну цифру и говорит, равна ли она ровно 1 или больше 1.",
            '(A | B | C) < | = | > 3': "Называет одну цифру и говорит, меньше она, равна или больше 3.",
            '(A | B | C) < | = | > 4': "Называет одну цифру и говорит, меньше она, равна или больше 4.",
            '(A < | > BC) | (B < | > AC) | (C < | > AB)': "Говорит, какая цифра наименьшая ИЛИ какая наибольшая: называет цифру и говорит, минимум это или максимум.",
            'A < | = | > (B | C)': "Сравнивает A с B или C: называет другую цифру и даёт сравнение (<, = или >).",
            'B < | = | > (A | C)': "Сравнивает B с A или C: называет другую цифру и даёт сравнение (<, = или >).",
            '(0 1 2 3)x 1 | 3': "Говорит, какую цифру он считает (1 или 3) и сколько раз эта цифра встречается (0-3).",
            '(0 1 2 3)x 3 | 4': "Говорит, какую цифру он считает (3 или 4) и сколько раз эта цифра встречается (0-3).",
            '(0 1 2 3)x 1 | 4': "Говорит, какую цифру он считает (1 или 4) и сколько раз эта цифра встречается (0-3).",
            '(A | B | C) < | = | > (A | B | C)': "Сравнивает две из трёх цифр: называет пару (A-B, B-C или A-C) и даёт сравнение (<, = или >)."
        }
    };

    function explainCriterion(n) {
        var set = criteriaExplainBase[currentLang] || criteriaExplainBase.en;
        var txt = set[n];
        if (txt) return txt;
        txt = criteriaExplainBase.en[n];
        return txt || '';
    }

    // ============================================================
    // UI Rendering
    // ============================================================

    function getCodeString() {
        return selectedCode.join('');
    }

    function updateUI(showSolution) {
        var cheatMode = document.getElementById('cheat').checked;
        var codeResult = generateCode(allCards, selectedCode[0], selectedCode[1], selectedCode[2]);

        // In normal play, verifiers keep their verified color until turn passes.
        // Cheat mode renders full truth tables for analysis (does not consume verifications).
        for (var i = 0; i < level.length; i++) {
            var el = document.getElementById('verifier-' + i);
            if (!el) continue;

            var v = level[i];

            if (cheatMode) {
                el.classList.remove('verified-green', 'verified-red');
                el.classList.add('expanded');
                updateMiniGrid(el, codeResult.card, v.card, true);
            } else {
                el.classList.remove('expanded');
                // Restore locked verdict state — toggling cheat must not erase it
                var verdictEl = el.querySelector('.verifier-verdict');
                if (verifiedIndices[i] !== undefined) {
                    el.classList.add(verifiedIndices[i] ? 'verified-green' : 'verified-red');
                    el.classList.add('locked');
                    if (verdictEl) verdictEl.textContent = verifiedIndices[i] ? t('yes') : t('no');
                } else {
                    el.classList.remove('verified-green', 'verified-red', 'locked');
                    if (verdictEl) verdictEl.textContent = '';
                }
            }
        }

        updateTurnUI();
    }

    function updateTurnUI() {
        if (gameOver) {
            var elGo = document.getElementById('verifications-left');
            if (elGo) {
                elGo.textContent = t('verifications', [0, maxVerifications]);
                elGo.className = 'badge badge-blocked';
            }

            var passGo = document.getElementById('pass-turn');
            if (passGo) passGo.disabled = true;

            var slotsGo = ['slot-a', 'slot-b', 'slot-c'];
            for (var sg = 0; sg < 3; sg++) {
                var buttonsGo = document.getElementById(slotsGo[sg]).querySelectorAll('.slot-btn');
                for (var bg = 0; bg < buttonsGo.length; bg++) {
                    buttonsGo[bg].disabled = true;
                }
            }

            if (level) {
                for (var vg = 0; vg < level.length; vg++) {
                    var relGo = document.getElementById('verifier-' + vg);
                    if (relGo) relGo.classList.add('blocked');
                }
            }

            var solGo = document.getElementById('solution');
            if (solGo) solGo.disabled = true;
            return;
        }

        var left = maxVerifications - verificationsUsed;
        var el = document.getElementById('verifications-left');
        if (el) {
            el.textContent = t('verifications', [left, maxVerifications]);
            el.className = 'badge ' + (turnBlocked ? 'badge-blocked' : (left > 0 ? '' : 'badge-blocked'));
        }

        var passBtn = document.getElementById('pass-turn');
        if (passBtn) {
            passBtn.disabled = false;
            var cheatModeNow = document.getElementById('cheat').checked;
            var pending = Object.keys(selectedVerifiers).length > 0;
            if (revealedThisTurn || !pending || turnBlocked || cheatModeNow) {
                passBtn.textContent = t('passTurn');
            } else {
                passBtn.textContent = t('reveal');
            }
        }

        // Lock slot buttons once the turn code is set, unlock otherwise
        var slots = ['slot-a', 'slot-b', 'slot-c'];
        for (var s = 0; s < 3; s++) {
            var buttons = document.getElementById(slots[s]).querySelectorAll('.slot-btn');
            for (var b = 0; b < buttons.length; b++) {
                if (turnCode !== null) {
                    buttons[b].disabled = true;
                } else {
                    buttons[b].disabled = false;
                }
            }
        }

        // Dim verifiers that can no longer be opened this turn (limit reached),
        // unless cheat mode is on (analysis mode does not consume verifications).
        var cheatMode = document.getElementById('cheat').checked;
        for (var v = 0; v < level.length; v++) {
            var rel = document.getElementById('verifier-' + v);
            if (!rel) continue;
            if (cheatMode) {
                rel.classList.remove('blocked');
            } else if (verifiedIndices[v] === undefined && turnBlocked) {
                rel.classList.add('blocked');
            } else {
                rel.classList.remove('blocked');
            }
        }
    }

    // Clicking a verifier during normal play marks it as "pending reveal":
    // the reveal button then shows an animated seal and applies the results.
    function toggleVerifierSelection(idx) {
        if (gameOver) return;
        if (turnBlocked) return;
        if (revealedThisTurn) return;   // already revealed this turn: verify done
        if (verifiedIndices[idx] !== undefined) return; // already revealed this turn

        // A full code (A, B, C all set) is required, like the physical game
        if (selectedCode[0] === 'x' || selectedCode[1] === 'x' || selectedCode[2] === 'x') {
            showToast(t('needFullCode'));
            return;
        }

        var el = document.getElementById('verifier-' + idx);
        if (!el) return;

        if (selectedVerifiers[idx]) {
            delete selectedVerifiers[idx];
            el.classList.remove('pending-reveal');
        } else {
            var available = maxVerifications - verificationsUsed;
            if (Object.keys(selectedVerifiers).length >= available) {
                showToast(t('revealLimit'));
                updateTurnUI();
                return;
            }
            selectedVerifiers[idx] = true;
            el.classList.add('pending-reveal');
        }
        updateTurnUI();
    }

    function doReveal() {
        if (gameOver) return;
        if (turnBlocked) return;
        if (revealedThisTurn) return;
        if (selectedCode[0] === 'x' || selectedCode[1] === 'x' || selectedCode[2] === 'x') {
            showToast(t('needFullCode'));
            return;
        }

        var idxs = Object.keys(selectedVerifiers).map(Number);
        if (!idxs.length) return;

        // Lock the code used for this reveal (same rule as a verification)
        if (turnCode === null) {
            turnCode = selectedCode.join('');
            updateTurnUI();
        }

        var btn = document.getElementById('pass-turn');
        if (btn) btn.disabled = true;

        // Flip each pending card: at the flip peak (card on edge) the result
        // is applied, so the second half of the turn shows YES/NO.
        var flipMs = 500;
        var swapMs = 225;
        for (var i = 0; i < idxs.length; i++) {
            var el = document.getElementById('verifier-' + idxs[i]);
            if (el) el.classList.add('flipping');
            (function (idx, card) {
                setTimeout(function () {
                    verifyVerifier(idx);
                    if (card) card.classList.remove('pending-reveal');
                }, swapMs);
                setTimeout(function () {
                    if (card) card.classList.remove('flipping');
                }, flipMs);
            })(idxs[i], el);
        }
        selectedVerifiers = {};
        revealedThisTurn = true;
        updateTurnUI();
    }

    // Clicking a verifier during normal play = verification (consumes 1 of 3).
    // Result is green if the tested code satisfies the secret answer of this criterion.
    function verifyVerifier(idx) {
        if (gameOver) return;
        if (turnBlocked) return;
        if (verifiedIndices[idx] !== undefined) return; // already verified this turn

        // A full code (A, B, C all set) is required to verify, like the physical game
        if (selectedCode[0] === 'x' || selectedCode[1] === 'x' || selectedCode[2] === 'x') {
            showToast(t('needFullCode'));
            return;
        }

        if (turnCode === null) {
            turnCode = selectedCode.join('');
            updateTurnUI();
        }

        // Build the exact code mask and check it against the secret answer card
        var codeCard = generateCode(allCards, selectedCode[0], selectedCode[1], selectedCode[2]).card;
        var result = false;
        for (var i = 0; i < codeCard.length; i++) {
            if (codeCard[i]) {
                result = !!level[idx].card[i];
                break;
            }
        }

        verifiedIndices[idx] = result;
        verificationsUsed++;

        turnResults.push({ index: idx, result: result });

        renderVerifierResult(idx, result);
        updateTurnUI();

        if (verificationsUsed >= maxVerifications) {
            turnBlocked = true;
            showToast(t('noMoreVerif'));
            updateTurnUI();
        }
    }

    function renderVerifierResult(idx, result) {
        var el = document.getElementById('verifier-' + idx);
        if (!el) return;
        el.classList.remove('neutral-hover');
        el.classList.add(result ? 'verified-green' : 'verified-red');
        el.classList.add('locked');

        var verdict = el.querySelector('.verifier-verdict');
        if (verdict) {
            verdict.textContent = result ? t('yes') : t('no');
        }
    }

    function resetVerifiersVisual() {
        for (var i = 0; i < level.length; i++) {
            var el = document.getElementById('verifier-' + i);
            if (!el) continue;
            el.classList.remove('verified-green', 'verified-red', 'locked', 'expanded', 'blocked', 'pending-reveal');
            var verdict = el.querySelector('.verifier-verdict');
            if (verdict) verdict.textContent = '';
            var answerEl = el.querySelector('.verifier-answer');
            if (answerEl) answerEl.className = 'verifier-answer neutral';
        }
    }

    function passTurn() {
        if (gameOver) return;
        // Finalize the completed turn into history before advancing
        history.push({
            turn: turnNumber,
            code: turnCode || getCodeString(),
            verifications: turnResults.slice()
        });

        turnNumber++;
        verificationsUsed = 0;
        turnBlocked = false;
        turnCode = null;
        verifiedIndices = {};
        turnResults = [];
        selectedVerifiers = {};
        revealedThisTurn = false;
        resetVerifiersVisual();
        updateTurnUI();
        renderHistory();
    }

    function showToast(msg) {
        var toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () {
            toast.classList.remove('show');
        }, 2200);
    }

    function renderHistory() {
        var list = document.getElementById('history-list');
        if (!list) return;
        list.innerHTML = '';

        if (history.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'history-empty';
            empty.textContent = t('noTurnsYet');
            list.appendChild(empty);
            return;
        }

        // Most recent turn first
        for (var i = history.length - 1; i >= 0; i--) {
            var h = history[i];
            var entry = document.createElement('div');
            entry.className = 'history-entry';

            var header = document.createElement('div');
            header.className = 'history-turn';
            header.textContent = t('turnFmt', [h.turn, h.code]);
            entry.appendChild(header);

            if (h.verifications.length === 0) {
                var none = document.createElement('div');
                none.className = 'history-none';
                none.textContent = t('noVerifiersUsed');
                entry.appendChild(none);
            } else {
                var chips = document.createElement('div');
                chips.className = 'history-chips';
                for (var v = 0; v < h.verifications.length; v++) {
                    var ver = h.verifications[v];
                    var chip = document.createElement('span');
                    chip.className = 'history-chip ' + (ver.result ? 'ok' : 'no');
                    chip.textContent = '#' + (ver.index + 1) + ' ' + (ver.result ? '✓' : '✗');
                    chips.appendChild(chip);
                }
                entry.appendChild(chips);
            }

            list.appendChild(entry);
        }

        list.scrollTop = list.scrollHeight;
    }

    function updateMiniGrid(verifierEl, codeCard, criteriaCard, cheatMode) {
        var gridEl = verifierEl.querySelector('.mini-grid');
        if (!gridEl) return;

        var cells = gridEl.querySelectorAll('.mini-cell');
        for (var i = 0; i < cells.length && i < pattern.pattern.length; i++) {
            if (cheatMode) {
                if (codeCard[i]) {
                    cells[i].className = 'mini-cell ' + (criteriaCard[i] ? 'green' : 'red');
                } else {
                    cells[i].className = 'mini-cell empty';
                }
            } else {
                cells[i].className = 'mini-cell ' + (criteriaCard[i] ? 'green' : 'red');
            }
        }
    }

    function buildVerifiersGrid() {
        var container = document.getElementById('verifiers-grid');
        container.innerHTML = '';

        for (var i = 0; i < level.length; i++) {
            var v = level[i];
            var div = document.createElement('div');
            div.className = 'verifier-rect';
            div.id = 'verifier-' + i;

            // Verifier number badge (1..N) — used to reference verifiers in history
            var numDiv = document.createElement('div');
            numDiv.className = 'verifier-num';
            numDiv.textContent = (i + 1);
            div.appendChild(numDiv);

            // Eye shown over the card while this verifier is pending reveal
            var eyeStamp = document.createElement('div');
            eyeStamp.className = 'verifier-eye';
            var eyeIcon = document.createElement('span');
            eyeIcon.className = 'verifier-eye-icon';
            eyeIcon.textContent = '\uD83D\uDC41'; // 👁
            eyeStamp.appendChild(eyeIcon);
            div.appendChild(eyeStamp);

            // Red dot shown when the player has marked options for this verifier
            var markDot = document.createElement('span');
            markDot.className = 'mark-indicator';
            div.appendChild(markDot);

            // Criterion name (human-readable) and its answer options
            var h = humanizeCriterion(v.name);
            var nameDiv = document.createElement('div');
            nameDiv.className = 'verifier-name';
            nameDiv.textContent = h.display;
            div.appendChild(nameDiv);

            if (h.opts.length > 0) {
                var optsDiv = document.createElement('div');
                optsDiv.className = 'verifier-opts';
                renderMarkedOpts(optsDiv, v.name, h.opts);
                div.appendChild(optsDiv);
            }

            // Verdict (YES/NO) shown after verification
            var verdictDiv = document.createElement('div');
            verdictDiv.className = 'verifier-verdict';
            verdictDiv.textContent = '';
            div.appendChild(verdictDiv);

            // Answer display (used in cheat mode)
            var answerDiv = document.createElement('div');
            answerDiv.className = 'verifier-answer neutral';
            answerDiv.textContent = '';
            div.appendChild(answerDiv);

            // Match count (used in cheat mode)
            var countDiv = document.createElement('div');
            countDiv.className = 'verifier-count';
            countDiv.textContent = '';
            div.appendChild(countDiv);

            // Mini grid (cheat analysis)
            var miniGridDiv = document.createElement('div');
            miniGridDiv.className = 'verifier-mini-grid';
            var miniGrid = document.createElement('div');
            miniGrid.className = 'mini-grid';
            var total = pattern.pattern.length;
            var cols = Math.ceil(Math.sqrt(total));
            miniGrid.style.gridTemplateColumns = 'repeat(' + cols + ', 8px)';
            // Fixed width keeps the flex-wrap fallback aligned to the same columns
            miniGrid.style.width = (cols * 9 + 8) + 'px';
            for (var j = 0; j < total; j++) {
                var cell = document.createElement('div');
                cell.className = 'mini-cell empty';
                miniGrid.appendChild(cell);
            }
            miniGridDiv.appendChild(miniGrid);
            div.appendChild(miniGridDiv);

            container.appendChild(div);
        }

        rebuildVerifierClickHandlers();
    }

    function rebuildVerifierClickHandlers() {
        var grid = document.getElementById('verifiers-grid');
        var rects = grid.querySelectorAll('.verifier-rect');
        for (var i = 0; i < rects.length; i++) {
            rects[i].addEventListener('click', (function (idx) {
                return function () {
                    if (gameOver) return;
                    // Pencil mode: opening the visual-mark editor instead of verifying
                    if (markMode) {
                        openVerifierMark(idx);
                        return;
                    }
                    var cheatMode = document.getElementById('cheat').checked;
                    if (cheatMode) {
                        this.classList.toggle('expanded');
                        var v = level[idx];
                        var codeResult = generateCode(allCards, selectedCode[0], selectedCode[1], selectedCode[2]);
                        updateMiniGrid(this, codeResult.card, v.card, true);
                        var answerEl = this.querySelector('.verifier-answer');
                        if (answerEl) answerEl.textContent = v.fullname;
                        var countEl = this.querySelector('.verifier-count');
                        if (countEl) countEl.textContent = countTrue(v.card) + '/' + pattern.pattern.length;
                        return;
                    }
                    toggleVerifierSelection(idx);
                };
            })(i));
        }
    }

    function setupSlotButtons() {
        var slots = ['slot-a', 'slot-b', 'slot-c'];
        for (var s = 0; s < 3; s++) {
            var slotEl = document.getElementById(slots[s]);
            var buttons = slotEl.querySelectorAll('.slot-btn');
            for (var b = 0; b < buttons.length; b++) {
                buttons[b].addEventListener('click', (function (slotIdx, btn) {
                    return function () {
                        if (turnCode !== null || turnBlocked || gameOver) return;
                        // Remove active from siblings
                        var siblings = btn.parentElement.querySelectorAll('.slot-btn');
                        for (var i = 0; i < siblings.length; i++) {
                            siblings[i].classList.remove('active');
                        }
                        btn.classList.add('active');
                        selectedCode[slotIdx] = btn.getAttribute('data-value');
                        updateUI(false);
                    };
                })(s, buttons[b]));
            }
            // Set initial active (x)
            buttons[0].classList.add('active');
        }
    }

    // ============================================================
    // Game Control
    // ============================================================

    function newGame() {
        var difficulty = parseInt(document.getElementById('difficulty').value);
        var verifiers = parseInt(document.getElementById('verifiers').value);

        // Reset selection and turn state
        selectedCode = ['x', 'x', 'x'];
        gameOver = false;
        turnNumber = 1;
        verificationsUsed = 0;
        turnBlocked = false;
        turnCode = null;
        verifiedIndices = {};
        turnResults = [];
        history = [];
        selectedVerifiers = {};
        revealedThisTurn = false;

        verifierMarks = {};
        leaveMarkMode();
        closeVerifierMark();

        closeSolutionModal();
        var solBtn = document.getElementById('solution');
        if (solBtn) solBtn.disabled = false;

        var slots = ['slot-a', 'slot-b', 'slot-c'];
        for (var s = 0; s < 3; s++) {
            var buttons = document.getElementById(slots[s]).querySelectorAll('.slot-btn');
            for (var b = 0; b < buttons.length; b++) {
                buttons[b].classList.remove('active');
                buttons[b].disabled = false;
            }
            buttons[0].classList.add('active');
        }

        level = generateLevel(verifiers, difficulty);

        if (!level) {
            console.error('TM: could not generate a level');
            showToast(t('levelGenFailed', [verifiers]));
            updateLevelStatus(null);
            buildVerifiersGrid();
            renderHistory();
            updateTurnUI();
            return;
        }

        var check = validateLevelExhaustive(level);
        if (!check.valid) {
            console.error('TM invariant failed:', check, level);
            showToast(t('levelGenFailed', [verifiers]));
            updateLevelStatus(null);
            buildVerifiersGrid();
            renderHistory();
            updateTurnUI();
            return;
        }

        console.log(check.consistentCount + ' Solution(s)');
        console.log(check.solution);

        // Verify no pair of verifiers is mutually exclusive (contradictory).
        var contradictionCheck = checkNoContradictions(level);
        if (!contradictionCheck.valid) {
            console.error('TM contradiction:', contradictionCheck.reason);
            showToast(t('levelContradiction'));
            updateLevelStatus(null);
            buildVerifiersGrid();
            renderHistory();
            updateTurnUI();
            return;
        }

        // Verify resolvability: every code must have a unique answer fingerprint,
        // so the solution is 100% determinable using only the selected verifiers.
        var resolvabilityCheck = checkFullResolvability(level);
        if (resolvabilityCheck.fullyResolvable) {
            console.log('Fully resolvable: all ' + resolvabilityCheck.totalCodes + ' codes have unique answer patterns');
        } else {
            console.warn('Partially resolvable: ' + resolvabilityCheck.uniquePatterns + '/' + resolvabilityCheck.totalCodes + ' codes are uniquely identifiable');
        }

        clearLevelStatus();

        buildVerifiersGrid();
        renderHistory();
        updateTurnUI();
    }

    function updateLevelStatus(solution) {
        var el = document.getElementById('level-status');
        if (!el) return;
        if (solution) {
            el.textContent = t('levelVerified', [solution]);
            el.classList.remove('err');
        } else {
            el.textContent = t('levelGenFailed', [document.getElementById('verifiers').value]);
            el.classList.add('err');
        }
        el.hidden = false;
    }

    function clearLevelStatus() {
        var el = document.getElementById('level-status');
        if (!el) return;
        el.hidden = true;
        el.classList.remove('err');
    }

    function showSolution() {
        if (gameOver) return;
        if (!level || level.length === 0) {
            showToast(t('levelGenFailed', [document.getElementById('verifiers').value]));
            return;
        }
        openSolutionModal();
    }

    function openSolutionModal() {
        if (gameOver) return;
        if (!level || level.length === 0) return;

        modalGuess = ['x', 'x', 'x'];

        document.getElementById('solution-modal-title').textContent = t('solutionTitle');

        var slotsWrap = document.getElementById('solution-slots');
        slotsWrap.innerHTML = '';

        var names = ['A', 'B', 'C'];
        for (var i = 0; i < 3; i++) {
            (function (slotIdx) {
                var slotEl = document.createElement('div');
                slotEl.className = 'slot';

                var label = document.createElement('span');
                label.className = 'slot-label';
                label.textContent = names[slotIdx];
                slotEl.appendChild(label);

                var btnGroup = document.createElement('div');
                btnGroup.className = 'slot-buttons';
                for (var v = 1; v <= 5; v++) {
                    (function (val) {
                        var b = document.createElement('button');
                        b.className = 'slot-btn modal-slot-btn';
                        b.type = 'button';
                        b.setAttribute('data-value', String(val));
                        b.textContent = String(val);
                        b.addEventListener('click', function () {
                            if (gameOver) return;
                            var sibs = b.parentElement.querySelectorAll('.slot-btn');
                            for (var k = 0; k < sibs.length; k++) {
                                sibs[k].classList.remove('active');
                            }
                            b.classList.add('active');
                            modalGuess[slotIdx] = String(val);
                        });
                        btnGroup.appendChild(b);
                    })(v);
                }
                slotEl.appendChild(btnGroup);
                slotsWrap.appendChild(slotEl);
            })(i);
        }

        var checkBtn = document.getElementById('solution-check');
        if (checkBtn) {
            checkBtn.disabled = false;
            checkBtn.textContent = t('solutionCheck');
        }

        var resultEl = document.getElementById('solution-result');
        resultEl.className = 'modal-result';
        resultEl.textContent = '';

        var newGameBtn = document.getElementById('solution-newgame');
        if (newGameBtn) {
            newGameBtn.style.display = 'none';
            newGameBtn.textContent = t('solutionNewGame');
        }

        document.getElementById('solution-modal').classList.add('open');
    }

    function checkGuessSolution(guess) {
        if (gameOver) return;
        if (!level || level.length === 0) return;

        var s = solutions(level);
        var solCode = [String(s[0].n[0]), String(s[0].n[1]), String(s[0].n[2])];
        var correct = guess[0] === solCode[0] && guess[1] === solCode[1] && guess[2] === solCode[2];

        var resultEl = document.getElementById('solution-result');
        var msg = correct ? t('solutionCorrect', [solCode.join('')]) : t('solutionWrong', [solCode.join('')]);
        resultEl.textContent = msg;
        resultEl.className = 'modal-result ' + (correct ? 'win' : 'lose');

        var newGameBtn = document.getElementById('solution-newgame');
        if (newGameBtn) newGameBtn.style.display = 'inline-block';

        var checkBtn = document.getElementById('solution-check');
        if (checkBtn) checkBtn.disabled = true;

        endGame(solCode);
    }

    function endGame(solCode) {
        gameOver = true;
        updateTurnUI();

        var slotIds = ['slot-a', 'slot-b', 'slot-c'];
        for (var i = 0; i < 3; i++) {
            var buttons = document.getElementById(slotIds[i]).querySelectorAll('.slot-btn');
            for (var b = 0; b < buttons.length; b++) {
                buttons[b].classList.remove('active');
                if (buttons[b].getAttribute('data-value') === solCode[i]) {
                    buttons[b].classList.add('active');
                }
            }
        }

        var solBtn = document.getElementById('solution');
        if (solBtn) solBtn.disabled = true;
    }

    function closeSolutionModalAsGiveUp() {
        if (gameOver) return;
        if (!level || level.length === 0) {
            closeSolutionModal();
            return;
        }
        var s = solutions(level);
        var solCode = [String(s[0].n[0]), String(s[0].n[1]), String(s[0].n[2])];
        var resultEl = document.getElementById('solution-result');
        resultEl.className = 'modal-result lose';
        resultEl.textContent = t('solutionWrong', [solCode.join('')]);
        var newGameBtn = document.getElementById('solution-newgame');
        if (newGameBtn) newGameBtn.style.display = 'inline-block';
        var checkBtn = document.getElementById('solution-check');
        if (checkBtn) checkBtn.disabled = true;
        endGame(solCode);
    }

    function closeSolutionModal() {
        var modal = document.getElementById('solution-modal');
        if (modal) modal.classList.remove('open');
    }

    function openVerifiersHelp() {
        if (!level || level.length === 0) return;
        document.getElementById('verifiers-help-title').textContent = t('verifiersHelpTitle');
        buildVerifiersHelpList();
        document.getElementById('verifiers-help-modal').classList.add('open');
    }

    function closeVerifiersHelp() {
        document.getElementById('verifiers-help-modal').classList.remove('open');
    }

    function buildTutorial() {
        var set = (I18N[currentLang] || I18N.en).ui;
        setText('tutorial-title', set.tutorialTitle);
        setText('tutorial-gotit', set.tutorialGotIt);

        var body = document.getElementById('tutorial-body');
        body.innerHTML = '';

        var sections = [
            { h: set.tutWhatH, ps: [set.tutWhatP] },
            { h: set.tutHowH, ps: [set.tutHowP1, set.tutHowP2, set.tutHowP3] },
            { h: set.tutUiH, items: set.tutUiItems }
        ];

        for (var i = 0; i < sections.length; i++) {
            var sec = document.createElement('section');
            sec.className = 'tutorial-section';

            var h = document.createElement('h3');
            h.textContent = sections[i].h;
            sec.appendChild(h);

            if (sections[i].ps) {
                for (var p = 0; p < sections[i].ps.length; p++) {
                    var par = document.createElement('p');
                    par.textContent = sections[i].ps[p];
                    sec.appendChild(par);
                }
            }
            if (sections[i].items) {
                var ul = document.createElement('ul');
                ul.className = 'tutorial-list';
                for (var it = 0; it < sections[i].items.length; it++) {
                    var li = document.createElement('li');
                    li.textContent = sections[i].items[it];
                    ul.appendChild(li);
                }
                sec.appendChild(ul);
            }
            body.appendChild(sec);
        }
    }

    function openTutorial() {
        buildTutorial();
        document.getElementById('tutorial-modal').classList.add('open');
    }

    function closeTutorial() {
        document.getElementById('tutorial-modal').classList.remove('open');
    }

    function buildVerifiersHelpList() {
        var list = document.getElementById('verifiers-help-list');
        list.innerHTML = '';
        for (var i = 0; i < level.length; i++) {
            var v = level[i];
            var h = humanizeCriterion(v.name);
            var entry = document.createElement('div');
            entry.className = 'verifiers-help-entry';

            var head = document.createElement('div');
            head.className = 'verifiers-help-head';

            var num = document.createElement('span');
            num.className = 'verifiers-help-num';
            num.textContent = (i + 1);
            head.appendChild(num);

            var name = document.createElement('span');
            name.className = 'verifiers-help-name';
            name.textContent = h.display;
            head.appendChild(name);
            entry.appendChild(head);

            if (h.opts && h.opts.length) {
                var opts = document.createElement('div');
                opts.className = 'verifiers-help-opts';
                opts.textContent = h.opts.join(' · ');
                entry.appendChild(opts);
            }

            var descText = explainCriterion(v.name);
            if (descText) {
                var desc = document.createElement('div');
                desc.className = 'verifiers-help-desc';
                desc.textContent = descText;
                entry.appendChild(desc);
            }

            list.appendChild(entry);
        }
    }

    // ============================================================
    // Mark mode — pencil: visually discard impossible options (NOTES ONLY)
    // ============================================================

    function toggleMarkMode() {
        markMode = !markMode;
        var btn = document.getElementById('verifiers-mark');
        if (btn) btn.classList.toggle('active', markMode);
        var grid = document.getElementById('verifiers-grid');
        if (grid) grid.classList.toggle('marking-mode', markMode);
    }

    function leaveMarkMode() {
        if (!markMode) return;
        markMode = false;
        var btn = document.getElementById('verifiers-mark');
        if (btn) btn.classList.remove('active');
        var grid = document.getElementById('verifiers-grid');
        if (grid) grid.classList.remove('marking-mode');
    }

    function openVerifierMark(idx) {
        if (!level || !level[idx]) return;
        var v = level[idx];
        var h = humanizeCriterion(v.name);
        document.getElementById('verifiers-mark-title').textContent = t('markTitle');
        var nameEl = document.getElementById('verifiers-mark-name');
        nameEl.textContent = h.display;
        document.getElementById('verifiers-mark-hint').textContent = t('markHint');

        var chips = document.getElementById('verifiers-mark-chips');
        chips.innerHTML = '';
        if (h.opts && h.opts.length) {
            for (var i = 0; i < h.opts.length; i++) {
                (function (opt) {
                    var chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = 'mark-chip';
                    chip.textContent = opt;
                    var marks = verifierMarks[v.name] || (verifierMarks[v.name] = {});
                    if (marks[opt]) chip.classList.add('marked');
                    chip.addEventListener('click', function () {
                        if (marks[opt]) { delete marks[opt]; }
                        else { marks[opt] = true; }
                        chip.classList.toggle('marked', !!marks[opt]);
                        syncMarkIndicator(idx);
                    });
                    chips.appendChild(chip);
                })(h.opts[i]);
            }
        } else {
            chips.textContent = t('markNoOptions');
        }

        document.getElementById('verifiers-mark-modal').classList.add('open');
    }

    function closeVerifierMark() {
        document.getElementById('verifiers-mark-modal').classList.remove('open');
    }

    // Render the opts line of a verifier on the grid, crossing out marked options
    function renderMarkedOpts(optsDiv, criterionName, opts) {
        optsDiv.textContent = '';
        var marks = verifierMarks[criterionName] || {};
        for (var i = 0; i < opts.length; i++) {
            if (i > 0) {
                var sep = document.createElement('span');
                sep.className = 'opt-sep';
                sep.textContent = ' · ';
                optsDiv.appendChild(sep);
            }
            var span = document.createElement('span');
            span.className = 'opt';
            if (marks[opts[i]]) span.classList.add('opt-marked');
            span.textContent = opts[i];
            optsDiv.appendChild(span);
        }
    }

    function syncMarkIndicator(idx) {
        var el = document.getElementById('verifier-' + idx);
        if (!el) return;
        var v = level[idx];
        var marks = verifierMarks[v.name];
        var count = 0;
        if (marks) {
            for (var k in marks) if (marks[k]) count++;
        }
        if (count > 0) el.classList.add('has-marks');
        else el.classList.remove('has-marks');

        // Re-render the opts line so crossed-out options are visible on the grid
        var optsDiv = el.querySelector('.verifier-opts');
        if (optsDiv) {
            var h = humanizeCriterion(v.name);
            renderMarkedOpts(optsDiv, v.name, h.opts);
        }
    }

    // ============================================================
    // Localization (default English; ES / FR / DE / RU)
    // ============================================================

    var LANG_KEY = 'tm-lang';
    var currentLang = 'en';

    var I18N = {
        en: {
            ui: {
                language: 'Language',
                difficulty: 'Difficulty',
                verifiers: 'Verifiers',
                newgame: 'New Game',
                solution: 'Solution',
                cheat: 'Cheat',
                colorblind: 'Colorblind',
                lightTheme: 'Light',
                darkTheme: 'Dark',
                passTurn: 'Pass Turn',
                reveal: 'Reveal',
                verifications: 'Verifications: {0}/{1}',
                history: 'History',
                noTurnsYet: 'No turns yet. Set a code and verify to start.',
                noVerifiersUsed: 'No verifiers used.',
                needFullCode: 'Select a full code (A, B and C) before verifying.',
                noMoreVerif: 'Verifications used up. Pass the turn.',
                revealLimit: 'You can only select up to 3 verifiers per turn.',
                yes: 'YES',
                no: 'NO',
                turnFmt: 'Turn {0} — Code {1}',
                solutionFmt: 'Solution: {0}',
                levelVerified: 'Level verified: unique solution {0}',
                levelGenFailed: 'Could not build a {0}-verifier level with this difficulty. New game aborted — try fewer verifiers or a lower difficulty.',
                solutionTitle: 'Enter your solution',
                solutionCheck: 'Check',
                solutionCorrect: 'Correct! The solution is {0}',
                solutionWrong: 'Wrong! The correct solution was {0}',
                solutionNewGame: 'New Game',
                verifiersHelpTitle: 'Verifier guide',
                verifiersHelp: 'Verifier help',
                markModeTooltip: 'Mark options (visual notes)',
                markTitle: 'Mark discarded options',
                markHint: 'Tap an option to cross it out when you know it cannot be true. Visual notes only — gameplay is not affected.',
                markNoOptions: 'Nothing to mark for this verifier.',
                tutorial: 'How to play',
                tutorialTitle: 'How to play',
                tutorialGotIt: 'Got it',
                tutWhatH: 'What is this game?',
                tutWhatP: 'Turing Machine is a deduction puzzle. A secret 3-digit code (digits 1-5) is hidden, and a set of "verifier" cards give you clues about it. By testing your code against the verifiers and reading their YES/NO answers, you narrow down the options until only one code fits — that is your answer.',
                tutHowH: 'How to play',
                tutHowP1: '1. Pick a code: choose a digit (1-5) or "x" for each slot A, B and C. Use "x" when you are not sure yet.',
                tutHowP2: '2. Test verifiers: pick up to 3 verifiers per turn, then press Reveal to see the YES/NO answers. Green means the clue is true for your code; red means false.',
                tutHowP3: '3. Deduce and finish: use the answers to discard possibilities, pass the turn to re-enable the verifiers, and when you are sure, press Solution and enter your code. The game ends when a code matches all the clues.',
                tutUiH: 'What is what in this interface',
                tutUiItems: [
                    'Difficulty and Verifiers: choose how hard the puzzle is and how many clue cards are used.',
                    'New Game: restart with a fresh puzzle. Solution: check your answer, or give up and see the code.',
                    'Cheat (optional): shows the hidden pattern and extra analysis. Colorblind: swaps red/green for blue/orange.',
                    'A B C slots: pick the code. Pass Turn: re-enables the verifiers after 3 checks.',
                    'Verifier cards: each one shows its clue. The blue ? opens the verifier guide; the pencil crosses out options you have discarded.',
                    'The eye icon on a card means the clue is waiting to be revealed — tap the card to flip it.',
                    'History (right side): keeps track of every turn and its answers.'
                ],
                difficultyOpts: ['Easy', 'Medium', 'Hard'],
                levelContradiction: 'Generated verifiers contradict each other. New game aborted — try again.'
            }
        },
        es: {
            ui: {
                language: 'Idioma',
                difficulty: 'Dificultad',
                verifiers: 'Verificadores',
                newgame: 'Nueva partida',
                solution: 'Solución',
                cheat: 'Trampa',
                colorblind: 'Daltónico',
                lightTheme: 'Claro',
                darkTheme: 'Oscuro',
                passTurn: 'Pasar turno',
                reveal: 'Revelar',
                verifications: 'Verificaciones: {0}/{1}',
                history: 'Historial',
                noTurnsYet: 'Aún no hay turnos. Elige un código y verifica para empezar.',
                noVerifiersUsed: 'Sin verificadores usados.',
                needFullCode: 'Selecciona un código completo (A, B y C) antes de verificar.',
                noMoreVerif: 'Verificaciones agotadas. Pasa el turno.',
                revealLimit: 'Solo puedes seleccionar hasta 3 verificadores por turno.',
                yes: 'SÍ',
                no: 'NO',
                turnFmt: 'Turno {0} — Código {1}',
                solutionFmt: 'Solución: {0}',
                levelVerified: 'Nivel verificado: solución única {0}',
                levelGenFailed: 'No se pudo generar un nivel con {0} verificadores en esta dificultad. Partida cancelada; prueba con menos verificadores o menor dificultad.',
                solutionTitle: 'Ingresa tu solución',
                solutionCheck: 'Verificar',
                solutionCorrect: '¡Correcto! La solución es {0}',
                solutionWrong: '¡Incorrecto! La solución correcta era {0}',
                solutionNewGame: 'Nueva partida',
                verifiersHelpTitle: 'Guía de verificadores',
                verifiersHelp: 'Ayuda de verificadores',
                markModeTooltip: 'Marcar opciones (notas visuales)',
                markTitle: 'Marcar opciones descartadas',
                markHint: 'Tocá una opción para tacharla cuando sepas que no puede ser. Solo notas visuales — el juego no cambia.',
                markNoOptions: 'Nada para marcar en este verificador.',
                tutorial: 'Cómo se juega',
                tutorialTitle: 'Cómo se juega',
                tutorialGotIt: 'Entendido',
                tutWhatH: '¿De qué va este juego?',
                tutWhatP: 'Turing Machine es un juego de deducción. Hay un código secreto de 3 dígitos (del 1 al 5) y un montón de cartas "verificador" que dan pistas sobre él. Probás tu código contra los verificadores, leés sus respuestas SÍ/NO y vas descartando posibilidades hasta que queda un único código posible: esa es tu respuesta.',
                tutHowH: 'Cómo se juega',
                tutHowP1: '1. Elegí un código: marcá un dígito (1-5) o "x" en cada casilla A, B y C. Usá "x" cuando todavía no estés seguro.',
                tutHowP2: '2. Probá verificadores: elegí hasta 3 verificadores por turno y tocá Revelar para ver las respuestas SÍ/NO. Verde = la pista es verdadera para tu código; rojo = falsa.',
                tutHowP3: '3. Deducí y terminá: usá las respuestas para descartar posibilidades, pasá el turno para reactivar los verificadores y, cuando estés seguro, tocá Solución e ingresá tu código. El juego termina cuando un código cumple todas las pistas.',
                tutUiH: 'Qué es cada cosa en esta interfaz',
                tutUiItems: [
                    'Dificultad y Verificadores: definen qué tan difícil es la partida y cuántas cartas de pista se usan.',
                    'Nueva partida: reinicia con un desafío nuevo. Solución: comprobá tu respuesta o rendite y mirá el código.',
                    'Trampa (opcional): muestra el patrón oculto y un análisis extra. Daltónico: cambia rojo/verde por azul/naranja.',
                    'Casillas A B C: elegís el código. Pasar turno: reactiva los verificadores después de 3 comprobaciones.',
                    'Cartas verificador: cada una muestra su pista. El ? azul abre la guía de verificadores; el lápiz permite tachar opciones que descartaste.',
                    'El ícono de ojo sobre una carta significa que la pista está esperando revelarse: tocá la carta para darla vuelta.',
                    'Historial (a la derecha): registra cada turno y sus respuestas.'
                ],
                difficultyOpts: ['Fácil', 'Media', 'Difícil'],
                levelContradiction: 'Los verificadores generados se contradicen. Partida cancelada; intenta de nuevo.'
            },
            criteria: {
                'A = | > 1': { d: 'A contra 1', o: ['= 1', '> 1'] },
                'A < | = | > 3': { d: 'A contra 3', o: ['< 3', '= 3', '> 3'] },
                'B < | = | > 3': { d: 'B contra 3', o: ['< 3', '= 3', '> 3'] },
                'B < | = | > 4': { d: 'B contra 4', o: ['< 4', '= 4', '> 4'] },
                'A Even | Odd': { d: 'Paridad de A', o: ['Par', 'Impar'] },
                'B Even | Odd': { d: 'Paridad de B', o: ['Par', 'Impar'] },
                'C Even | Odd': { d: 'Paridad de C', o: ['Par', 'Impar'] },
                '(0 1 2 3)x 1': { d: 'Cantidad de 1', o: ['0', '1', '2', '3'] },
                '(0 1 2 3)x 3': { d: 'Cantidad de 3', o: ['0', '1', '2', '3'] },
                '(0 1 2 3)x 4': { d: 'Cantidad de 4', o: ['0', '1', '2', '3'] },
                'A < | = | > B': { d: 'A contra B', o: ['<', '=', '>'] },
                'A < | = | > C': { d: 'A contra C', o: ['<', '=', '>'] },
                'B < | = | > C': { d: 'B contra C', o: ['<', '=', '>'] },
                '(A < BC) | (B < AC) | (C < AB)': { d: 'Dígito menor', o: ['A', 'B', 'C'] },
                '(A > BC) | (B > AC) | (C > AB)': { d: 'Dígito mayor', o: ['A', 'B', 'C'] },
                'Even > | < Odd': { d: 'Pares vs impares', o: ['Más pares', 'Más impares'] },
                '(0 1 2 3)x Even': { d: 'Cantidad de pares', o: ['0', '1', '2', '3'] },
                '(A + B + C) Even | Odd': { d: 'Paridad de la suma', o: ['Par', 'Impar'] },
                '(A + B) < | = | > 6': { d: 'A+B contra 6', o: ['< 6', '= 6', '> 6'] },
                '(0/1 2 3)x X': { d: 'Dígitos repetidos', o: ['Ninguno', 'Un par', 'Trío'] },
                'X X Y Yes | No': { d: '¿Tiene un par?', o: ['Sí', 'No'] },
                '(A < B < C) | (A > B > C) | (A ? B ? C)': { d: 'Orden de A,B,C', o: ['Ascendente', 'Descendente', 'Ninguno'] },
                '(A + B + C) < | = | > 6': { d: 'Suma contra 6', o: ['< 6', '= 6', '> 6'] },
                '(0 2 3) Increment': { d: 'Pasos de +1', o: ['Ninguno', 'Uno', 'Todos'] },
                '(0 2 3) Increment/Decrement': { d: 'Pasos de ±1', o: ['Ninguno', 'Uno', 'Todos'] },
                '(A | B | C) < 3': { d: '¿Cuál es < 3?', o: ['A', 'B', 'C'] },
                '(A | B | C) < 4': { d: '¿Cuál es < 4?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 1': { d: '¿Cuál es = 1?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 3': { d: '¿Cuál es = 3?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 4': { d: '¿Cuál es = 4?', o: ['A', 'B', 'C'] },
                '(A | B | C) > 1': { d: '¿Cuál es > 1?', o: ['A', 'B', 'C'] },
                '(A | B | C) > 3': { d: '¿Cuál es > 3?', o: ['A', 'B', 'C'] },
                '(A | B | C) Even | Odd': { d: '¿Cuál es par/impar?', o: ['A par', 'A impar', 'B par', 'B impar', 'C par', 'C impar'] },
                '(A <= BC) | (B <= AC) | (C <= AB)': { d: 'Menor (empates ok)', o: ['A', 'B', 'C'] },
                '(A >= BC) | (B >= AC) | (C >= AB)': { d: 'Mayor (empates ok)', o: ['A', 'B', 'C'] },
                '(A + B + C) = 3x | 4x | 5x': { d: 'La suma es múltiplo de', o: ['3', '4', '5'] },
                '(A + B) | (B + C) | (A + C) = 4': { d: 'Una suma de pares da 4', o: ['A+B', 'B+C', 'A+C'] },
                '(A + B) | (B + C) | (A + C) = 6': { d: 'Una suma de pares da 6', o: ['A+B', 'B+C', 'A+C'] },
                '(A | B | C) = | > 1': { d: '¿Cuál es 1 o > 1?', o: ['A', 'B', 'C'] },
                '(A | B | C) < | = | > 3': { d: '¿Cuál casilla contra 3?', o: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
                '(A | B | C) < | = | > 4': { d: '¿Cuál casilla contra 4?', o: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
                '(A < | > BC) | (B < | > AC) | (C < | > AB)': { d: '¿Menor o mayor?', o: ['A mín', 'B mín', 'C mín', 'A máx', 'B máx', 'C máx'] },
                'A < | = | > (B | C)': { d: 'A contra B o C', o: ['A<B', 'A=B', 'A>B', 'A<C', 'A=C', 'A>C'] },
                'B < | = | > (A | C)': { d: 'B contra A o C', o: ['B<A', 'B=A', 'B>A', 'B<C', 'B=C', 'B>C'] },
                '(0 1 2 3)x 1 | 3': { d: 'Cantidad de 1 o 3', o: ['1: 0-3', '3: 0-3'] },
                '(0 1 2 3)x 3 | 4': { d: 'Cantidad de 3 o 4', o: ['3: 0-3', '4: 0-3'] },
                '(0 1 2 3)x 1 | 4': { d: 'Cantidad de 1 o 4', o: ['1: 0-3', '4: 0-3'] },
                '(A | B | C) < | = | > (A | B | C)': { d: 'Comparaciones A, B, C', o: ['A<B', 'A=B', 'A>B', 'B<C', 'B=C', 'B>C', 'A<C', 'A=C', 'A>C'] }
            }
        },
        fr: {
            ui: {
                language: 'Langue',
                difficulty: 'Difficulté',
                verifiers: 'Vérificateurs',
                newgame: 'Nouvelle partie',
                solution: 'Solution',
                cheat: 'Triche',
                colorblind: 'Daltonien',
                lightTheme: 'Clair',
                darkTheme: 'Sombre',
                passTurn: 'Passer le tour',
                reveal: 'Révéler',
                verifications: 'Vérifications : {0}/{1}',
                history: 'Historique',
                noTurnsYet: 'Aucun tour pour l\'instant. Choisissez un code et vérifiez pour commencer.',
                noVerifiersUsed: 'Aucun vérificateur utilisé.',
                needFullCode: 'Sélectionnez un code complet (A, B et C) avant de vérifier.',
                noMoreVerif: 'Vérifications épuisées. Passez le tour.',
                revealLimit: 'Vous pouvez sélectionner jusqu\'à 3 vérificateurs par tour.',
                yes: 'OUI',
                no: 'NON',
                turnFmt: 'Tour {0} — Code {1}',
                solutionFmt: 'Solution : {0}',
                levelVerified: 'Niveau vérifié : solution unique {0}',
                levelGenFailed: 'Impossible de créer un niveau à {0} vérificateurs avec cette difficulté. Partie annulée — essayez moins de vérificateurs ou une difficulté plus faible.',
                solutionTitle: 'Entrez votre solution',
                solutionCheck: 'Vérifier',
                solutionCorrect: 'Correct ! La solution est {0}',
                solutionWrong: 'Faux ! La solution correcte était {0}',
                solutionNewGame: 'Nouvelle partie',
                verifiersHelpTitle: 'Guide des vérificateurs',
                verifiersHelp: 'Aide des vérificateurs',
                markModeTooltip: 'Marquer les options (notes visuelles)',
                markTitle: 'Marquer les options éliminées',
                markHint: 'Touchez une option pour la barrer quand vous savez qu\'elle ne peut pas être vraie. Simples notes visuelles — le jeu n\'est pas affecté.',
                markNoOptions: 'Rien à marquer pour ce vérificateur.',
                tutorial: 'Comment jouer',
                tutorialTitle: 'Comment jouer',
                tutorialGotIt: 'Compris',
                tutWhatH: 'De quoi s\'agit-il ?',
                tutWhatP: 'Turing Machine est un jeu de déduction. Un code secret de 3 chiffres (de 1 à 5) est caché, et des cartes « vérificateur » vous donnent des indices. Testez votre code contre les vérificateurs, lisez leurs réponses OUI/NON et éliminez les possibilités jusqu\'à ce qu\'un seul code reste : c\'est votre réponse.',
                tutHowH: 'Comment jouer',
                tutHowP1: '1. Choisissez un code : indiquez un chiffre (1 à 5) ou « x » dans chaque emplacement A, B et C. Utilisez « x » quand vous n\'êtes pas encore sûr.',
                tutHowP2: '2. Testez les vérificateurs : choisissez jusqu\'à 3 vérificateurs par tour, puis appuyez sur Révéler pour voir les réponses OUI/NON. Vert = l\'indice est vrai pour votre code ; rouge = faux.',
                tutHowP3: '3. Déduisez et terminez : utilisez les réponses pour éliminer des possibilités, passez le tour pour réactiver les vérificateurs et, quand vous êtes sûr, appuyez sur Solution et saisissez votre code. La partie se termine quand un code respecte tous les indices.',
                tutUiH: 'À quoi sert chaque élément',
                tutUiItems: [
                    'Difficulté et Vérificateurs : choisissez la difficulté et le nombre de cartes d\'indices.',
                    'Nouvelle partie : recommence avec un nouveau défi. Solution : vérifiez votre réponse ou abandonnez et voyez le code.',
                    'Triche (optionnel) : montre le motif caché et une analyse supplémentaire. Daltonien : remplace rouge/vert par bleu/orange.',
                    'Emplacements A B C : choisissez le code. Passer le tour : réactive les vérificateurs après 3 vérifications.',
                    'Cartes vérificateur : chacune affiche son indice. Le ? bleu ouvre le guide des vérificateurs ; le crayon sert à rayer les options éliminées.',
                    'L\'icône œil sur une carte indique que l\'indice attend d\'être révélé : touchez la carte pour la retourner.',
                    'Historique (à droite) : garde la trace de chaque tour et de ses réponses.'
                ],
                difficultyOpts: ['Facile', 'Moyenne', 'Difficile'],
                levelContradiction: 'Les vérificateurs générés se contredisent. Partie annulée — veuillez réessayer.'
            },
            criteria: {
                'A = | > 1': { d: 'A comparé à 1', o: ['= 1', '> 1'] },
                'A < | = | > 3': { d: 'A comparé à 3', o: ['< 3', '= 3', '> 3'] },
                'B < | = | > 3': { d: 'B comparé à 3', o: ['< 3', '= 3', '> 3'] },
                'B < | = | > 4': { d: 'B comparé à 4', o: ['< 4', '= 4', '> 4'] },
                'A Even | Odd': { d: 'Parité de A', o: ['Pair', 'Impair'] },
                'B Even | Odd': { d: 'Parité de B', o: ['Pair', 'Impair'] },
                'C Even | Odd': { d: 'Parité de C', o: ['Pair', 'Impair'] },
                '(0 1 2 3)x 1': { d: 'Nombre de 1', o: ['0', '1', '2', '3'] },
                '(0 1 2 3)x 3': { d: 'Nombre de 3', o: ['0', '1', '2', '3'] },
                '(0 1 2 3)x 4': { d: 'Nombre de 4', o: ['0', '1', '2', '3'] },
                'A < | = | > B': { d: 'A comparé à B', o: ['<', '=', '>'] },
                'A < | = | > C': { d: 'A comparé à C', o: ['<', '=', '>'] },
                'B < | = | > C': { d: 'B comparé à C', o: ['<', '=', '>'] },
                '(A < BC) | (B < AC) | (C < AB)': { d: 'Chiffre le plus petit', o: ['A', 'B', 'C'] },
                '(A > BC) | (B > AC) | (C > AB)': { d: 'Chiffre le plus grand', o: ['A', 'B', 'C'] },
                'Even > | < Odd': { d: 'Pairs vs impairs', o: ['Plus de pairs', "Plus d'impairs"] },
                '(0 1 2 3)x Even': { d: 'Nombre de pairs', o: ['0', '1', '2', '3'] },
                '(A + B + C) Even | Odd': { d: 'Parité de la somme', o: ['Pair', 'Impair'] },
                '(A + B) < | = | > 6': { d: 'A+B comparé à 6', o: ['< 6', '= 6', '> 6'] },
                '(0/1 2 3)x X': { d: 'Chiffres répétés', o: ['Aucun', 'Une paire', 'Triplé'] },
                'X X Y Yes | No': { d: 'A-t-il une paire ?', o: ['Oui', 'Non'] },
                '(A < B < C) | (A > B > C) | (A ? B ? C)': { d: 'Ordre A,B,C', o: ['Croissant', 'Décroissant', 'Aucun'] },
                '(A + B + C) < | = | > 6': { d: 'Somme comparée à 6', o: ['< 6', '= 6', '> 6'] },
                '(0 2 3) Increment': { d: 'Pas de +1', o: ['Aucun', 'Un', 'Tous'] },
                '(0 2 3) Increment/Decrement': { d: 'Pas de ±1', o: ['Aucun', 'Un', 'Tous'] },
                '(A | B | C) < 3': { d: 'Lequel est < 3 ?', o: ['A', 'B', 'C'] },
                '(A | B | C) < 4': { d: 'Lequel est < 4 ?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 1': { d: 'Lequel est = 1 ?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 3': { d: 'Lequel est = 3 ?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 4': { d: 'Lequel est = 4 ?', o: ['A', 'B', 'C'] },
                '(A | B | C) > 1': { d: 'Lequel est > 1 ?', o: ['A', 'B', 'C'] },
                '(A | B | C) > 3': { d: 'Lequel est > 3 ?', o: ['A', 'B', 'C'] },
                '(A | B | C) Even | Odd': { d: 'Qui est pair/impair ?', o: ['A pair', 'A impair', 'B pair', 'B impair', 'C pair', 'C impair'] },
                '(A <= BC) | (B <= AC) | (C <= AB)': { d: 'Plus petit (égalités ok)', o: ['A', 'B', 'C'] },
                '(A >= BC) | (B >= AC) | (C >= AB)': { d: 'Plus grand (égalités ok)', o: ['A', 'B', 'C'] },
                '(A + B + C) = 3x | 4x | 5x': { d: 'La somme est multiple de', o: ['3', '4', '5'] },
                '(A + B) | (B + C) | (A + C) = 4': { d: 'Une paire somme à 4', o: ['A+B', 'B+C', 'A+C'] },
                '(A + B) | (B + C) | (A + C) = 6': { d: 'Une paire somme à 6', o: ['A+B', 'B+C', 'A+C'] },
                '(A | B | C) = | > 1': { d: 'Lequel vaut 1 ou > 1 ?', o: ['A', 'B', 'C'] },
                '(A | B | C) < | = | > 3': { d: 'Quelle case vs 3 ?', o: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
                '(A | B | C) < | = | > 4': { d: 'Quelle case vs 4 ?', o: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
                '(A < | > BC) | (B < | > AC) | (C < | > AB)': { d: 'Plus petit ou plus grand ?', o: ['A min', 'B min', 'C min', 'A max', 'B max', 'C max'] },
                'A < | = | > (B | C)': { d: 'A comparé à B ou C', o: ['A<B', 'A=B', 'A>B', 'A<C', 'A=C', 'A>C'] },
                'B < | = | > (A | C)': { d: 'B comparé à A ou C', o: ['B<A', 'B=A', 'B>A', 'B<C', 'B=C', 'B>C'] },
                '(0 1 2 3)x 1 | 3': { d: 'Nombre de 1 ou 3', o: ['1 : 0-3', '3 : 0-3'] },
                '(0 1 2 3)x 3 | 4': { d: 'Nombre de 3 ou 4', o: ['3 : 0-3', '4 : 0-3'] },
                '(0 1 2 3)x 1 | 4': { d: 'Nombre de 1 ou 4', o: ['1 : 0-3', '4 : 0-3'] },
                '(A | B | C) < | = | > (A | B | C)': { d: 'Comparaisons A, B, C', o: ['A<B', 'A=B', 'A>B', 'B<C', 'B=C', 'B>C', 'A<C', 'A=C', 'A>C'] }
            }
        },
        de: {
            ui: {
                language: 'Sprache',
                difficulty: 'Schwierigkeit',
                verifiers: 'Prüfer',
                newgame: 'Neues Spiel',
                solution: 'Lösung',
                cheat: 'Schummeln',
                colorblind: 'Farbenblind',
                lightTheme: 'Hell',
                darkTheme: 'Dunkel',
                passTurn: 'Zug beenden',
                reveal: 'Aufdecken',
                verifications: 'Prüfungen: {0}/{1}',
                history: 'Verlauf',
                noTurnsYet: 'Noch keine Züge. Wähle einen Code und prüfe, um zu starten.',
                noVerifiersUsed: 'Keine Prüfer verwendet.',
                needFullCode: 'Wähle zuerst einen vollständigen Code (A, B und C).',
                noMoreVerif: 'Prüfungen aufgebraucht. Beende den Zug.',
                revealLimit: 'Du kannst pro Zug nur bis zu 3 Prüfer auswählen.',
                yes: 'JA',
                no: 'NEIN',
                turnFmt: 'Zug {0} — Code {1}',
                solutionFmt: 'Lösung: {0}',
                levelVerified: 'Niveau geprüft: eindeutige Lösung {0}',
                levelGenFailed: 'Konnte kein {0}-Prüfer-Niveau mit dieser Schwierigkeit erstellen. Spiel abgebrochen — versuche weniger Prüfer oder eine niedrigere Schwierigkeit.',
                solutionTitle: 'Lösung eingeben',
                solutionCheck: 'Prüfen',
                solutionCorrect: 'Richtig! Die Lösung ist {0}',
                solutionWrong: 'Falsch! Die richtige Lösung war {0}',
                solutionNewGame: 'Neues Spiel',
                verifiersHelpTitle: 'Prüfer-Anleitung',
                verifiersHelp: 'Prüfer-Hilfe',
                markModeTooltip: 'Optionen markieren (visuelle Notizen)',
                markTitle: 'Verworfene Optionen markieren',
                markHint: 'Tippe eine Option an, um sie durchzustreichen, wenn du weißt, dass sie nicht zutreffen kann. Nur visuelle Notizen — das Spiel bleibt unverändert.',
                markNoOptions: 'Bei diesem Prüfer gibt es nichts zu markieren.',
                tutorial: 'Anleitung',
                tutorialTitle: 'So spielst du',
                tutorialGotIt: 'Verstanden',
                tutWhatH: 'Worum geht es?',
                tutWhatP: 'Turing Machine ist ein Deduktionsspiel. Ein geheimer 3-stelliger Code (Ziffern 1-5) ist versteckt, und „Verifier"-Karten geben Hinweise darauf. Teste deinen Code an den Verifiern, lies ihre JA/NEIN-Antworten und schließe Möglichkeiten aus, bis nur noch ein Code übrig ist — das ist deine Antwort.',
                tutHowH: 'So wird gespielt',
                tutHowP1: '1. Code wählen: Wähle in jedem Feld A, B und C eine Ziffer (1-5) oder „x". Nutze „x", wenn du dir noch nicht sicher bist.',
                tutHowP2: '2. Verifier testen: Wähle bis zu 3 Verifier pro Zug und drücke Aufdecken, um die JA/NEIN-Antworten zu sehen. Grün = der Hinweis stimmt für deinen Code; Rot = er stimmt nicht.',
                tutHowP3: '3. Kombinieren und lösen: Nutze die Antworten, um Möglichkeiten auszuschließen, gib den Zug ab, um die Verifier zu reaktivieren, und drücke Lösung, sobald du sicher bist, und gib deinen Code ein. Das Spiel endet, wenn ein Code alle Hinweise erfüllt.',
                tutUiH: 'Was ist was in dieser Oberfläche',
                tutUiItems: [
                    'Schwierigkeit und Verifier: legen fest, wie schwer das Rätsel ist und wie viele Hinweiskarten benutzt werden.',
                    'Neues Spiel: startet ein neues Rätsel. Lösung: prüfe deine Antwort oder gib auf und sieh dir den Code an.',
                    'Trick (optional): zeigt das versteckte Muster und eine Zusatzanalyse. Farbenblind: ersetzt Rot/Grün durch Blau/Orange.',
                    'Fächer A B C: hier wählst du den Code. Zug beenden: reaktiviert die Verifier nach 3 Prüfungen.',
                    'Verifier-Karten: jede zeigt ihren Hinweis. Das blaue ? öffnet den Verifier-Guide; der Stift streicht ausgeschlossene Optionen durch.',
                    'Das Augensymbol auf einer Karte bedeutet, dass der Hinweis auf Aufdeckung wartet — tippe die Karte, um sie umzudrehen.',
                    'Verlauf (rechts): protokolliert jeden Zug und seine Antworten.'
                ],
                difficultyOpts: ['Leicht', 'Mittel', 'Schwer'],
                levelContradiction: 'Die generierten Prüfer widersprechen sich. Spiel abgebrochen — bitte erneut versuchen.'
            },
            criteria: {
                'A = | > 1': { d: 'A vs 1', o: ['= 1', '> 1'] },
                'A < | = | > 3': { d: 'A vs 3', o: ['< 3', '= 3', '> 3'] },
                'B < | = | > 3': { d: 'B vs 3', o: ['< 3', '= 3', '> 3'] },
                'B < | = | > 4': { d: 'B vs 4', o: ['< 4', '= 4', '> 4'] },
                'A Even | Odd': { d: 'Parität von A', o: ['Gerade', 'Ungerade'] },
                'B Even | Odd': { d: 'Parität von B', o: ['Gerade', 'Ungerade'] },
                'C Even | Odd': { d: 'Parität von C', o: ['Gerade', 'Ungerade'] },
                '(0 1 2 3)x 1': { d: 'Anzahl der 1', o: ['0', '1', '2', '3'] },
                '(0 1 2 3)x 3': { d: 'Anzahl der 3', o: ['0', '1', '2', '3'] },
                '(0 1 2 3)x 4': { d: 'Anzahl der 4', o: ['0', '1', '2', '3'] },
                'A < | = | > B': { d: 'A vs B', o: ['<', '=', '>'] },
                'A < | = | > C': { d: 'A vs C', o: ['<', '=', '>'] },
                'B < | = | > C': { d: 'B vs C', o: ['<', '=', '>'] },
                '(A < BC) | (B < AC) | (C < AB)': { d: 'Kleinste Ziffer', o: ['A', 'B', 'C'] },
                '(A > BC) | (B > AC) | (C > AB)': { d: 'Größte Ziffer', o: ['A', 'B', 'C'] },
                'Even > | < Odd': { d: 'Gerade vs ungerade', o: ['Mehr gerade', 'Mehr ungerade'] },
                '(0 1 2 3)x Even': { d: 'Anzahl gerader', o: ['0', '1', '2', '3'] },
                '(A + B + C) Even | Odd': { d: 'Parität der Summe', o: ['Gerade', 'Ungerade'] },
                '(A + B) < | = | > 6': { d: 'A+B vs 6', o: ['< 6', '= 6', '> 6'] },
                '(0/1 2 3)x X': { d: 'Wiederholte Ziffern', o: ['Keine', 'Ein Paar', 'Dreifach'] },
                'X X Y Yes | No': { d: 'Enthält ein Paar?', o: ['Ja', 'Nein'] },
                '(A < B < C) | (A > B > C) | (A ? B ? C)': { d: 'Reihenfolge A,B,C', o: ['Aufsteigend', 'Absteigend', 'Keins'] },
                '(A + B + C) < | = | > 6': { d: 'Summe vs 6', o: ['< 6', '= 6', '> 6'] },
                '(0 2 3) Increment': { d: 'Schritte +1', o: ['Keine', 'Einer', 'Alle'] },
                '(0 2 3) Increment/Decrement': { d: 'Schritte ±1', o: ['Keine', 'Einer', 'Alle'] },
                '(A | B | C) < 3': { d: 'Welches ist < 3?', o: ['A', 'B', 'C'] },
                '(A | B | C) < 4': { d: 'Welches ist < 4?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 1': { d: 'Welches ist = 1?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 3': { d: 'Welches ist = 3?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 4': { d: 'Welches ist = 4?', o: ['A', 'B', 'C'] },
                '(A | B | C) > 1': { d: 'Welches ist > 1?', o: ['A', 'B', 'C'] },
                '(A | B | C) > 3': { d: 'Welches ist > 3?', o: ['A', 'B', 'C'] },
                '(A | B | C) Even | Odd': { d: 'Welches gerade/ungerade?', o: ['A gerade', 'A ungerade', 'B gerade', 'B ungerade', 'C gerade', 'C ungerade'] },
                '(A <= BC) | (B <= AC) | (C <= AB)': { d: 'Kleinste (Gleichstand ok)', o: ['A', 'B', 'C'] },
                '(A >= BC) | (B >= AC) | (C >= AB)': { d: 'Größte (Gleichstand ok)', o: ['A', 'B', 'C'] },
                '(A + B + C) = 3x | 4x | 5x': { d: 'Summe ist Vielfaches von', o: ['3', '4', '5'] },
                '(A + B) | (B + C) | (A + C) = 4': { d: 'Paarsumme = 4', o: ['A+B', 'B+C', 'A+C'] },
                '(A + B) | (B + C) | (A + C) = 6': { d: 'Paarsumme = 6', o: ['A+B', 'B+C', 'A+C'] },
                '(A | B | C) = | > 1': { d: 'Welches ist 1 oder > 1?', o: ['A', 'B', 'C'] },
                '(A | B | C) < | = | > 3': { d: 'Welche Stelle vs 3?', o: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
                '(A | B | C) < | = | > 4': { d: 'Welche Stelle vs 4?', o: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
                '(A < | > BC) | (B < | > AC) | (C < | > AB)': { d: 'Kleinste oder größte?', o: ['A min', 'B min', 'C min', 'A max', 'B max', 'C max'] },
                'A < | = | > (B | C)': { d: 'A vs B oder C', o: ['A<B', 'A=B', 'A>B', 'A<C', 'A=C', 'A>C'] },
                'B < | = | > (A | C)': { d: 'B vs A oder C', o: ['B<A', 'B=A', 'B>A', 'B<C', 'B=C', 'B>C'] },
                '(0 1 2 3)x 1 | 3': { d: 'Anzahl an 1 oder 3', o: ['1er: 0-3', '3er: 0-3'] },
                '(0 1 2 3)x 3 | 4': { d: 'Anzahl an 3 oder 4', o: ['3er: 0-3', '4er: 0-3'] },
                '(0 1 2 3)x 1 | 4': { d: 'Anzahl an 1 oder 4', o: ['1er: 0-3', '4er: 0-3'] },
                '(A | B | C) < | = | > (A | B | C)': { d: 'Vergleiche A, B, C', o: ['A<B', 'A=B', 'A>B', 'B<C', 'B=C', 'B>C', 'A<C', 'A=C', 'A>C'] }
            }
        },
        ru: {
            ui: {
                language: 'Язык',
                difficulty: 'Сложность',
                verifiers: 'Проверки',
                newgame: 'Новая игра',
                solution: 'Решение',
                cheat: 'Подсказки',
                colorblind: 'Дальтонизм',
                lightTheme: 'Светлая',
                darkTheme: 'Тёмная',
                passTurn: 'Завершить ход',
                reveal: 'Раскрыть',
                verifications: 'Проверки: {0}/{1}',
                history: 'История',
                noTurnsYet: 'Ходов пока нет. Выберите код и проверьте, чтобы начать.',
                noVerifiersUsed: 'Проверки не использовались.',
                needFullCode: 'Выберите полный код (A, B и C) перед проверкой.',
                noMoreVerif: 'Проверки закончились. Завершите ход.',
                revealLimit: 'Можно выбрать не более 3 проверяющих за ход.',
                yes: 'ДА',
                no: 'НЕТ',
                turnFmt: 'Ход {0} — Код {1}',
                solutionFmt: 'Решение: {0}',
                levelVerified: 'Уровень проверен: уникальное решение {0}',
                levelGenFailed: 'Не удалось создать уровень с {0} проверками на этой сложности. Игра отменена — попробуйте меньше проверок или проще сложность.',
                solutionTitle: 'Введите решение',
                solutionCheck: 'Проверить',
                solutionCorrect: 'Правильно! Решение: {0}',
                solutionWrong: 'Неправильно! Правильное решение: {0}',
                solutionNewGame: 'Новая игра',
                verifiersHelpTitle: 'Справка по проверкам',
                verifiersHelp: 'Помощь по проверкам',
                markModeTooltip: 'Отметить варианты (визуальные заметки)',
                markTitle: 'Отметить отброшенные варианты',
                markHint: 'Нажмите на вариант, чтобы зачеркнуть его, если вы знаете, что он невозможен. Только визуальные заметки — игра не меняется.',
                markNoOptions: 'Этому проверяющему нечего отмечать.',
                tutorial: 'Как играть',
                tutorialTitle: 'Как играть',
                tutorialGotIt: 'Понятно',
                tutWhatH: 'Что это за игра?',
                tutWhatP: '«Машина Тьюринга» — это игра на дедукцию. Скрыт секретный код из 3 цифр (от 1 до 5), а карточки-«верификаторы» дают о нём подсказки. Проверяй свой код на верификаторах, читай ответы ДА/НЕТ и отбрасывай варианты, пока не останется единственный код — это и есть ответ.',
                tutHowH: 'Как играть',
                tutHowP1: '1. Выбери код: поставь цифру (1–5) или «x» в каждом слоте A, B и C. Используй «x», если пока не уверен.',
                tutHowP2: '2. Проверяй верификаторов: выбирай до 3 верификаторов за ход и нажми «Раскрыть», чтобы увидеть ответы ДА/НЕТ. Зелёный = подсказка верна для твоего кода; красный = неверна.',
                tutHowP3: '3. Рассуждай и завершай: используй ответы, чтобы исключать варианты, передай ход, чтобы снова активировать верификаторов, а когда уверен — нажми «Решение» и введи свой код. Игра заканчивается, когда код соответствует всем подсказкам.',
                tutUiH: 'Что есть что в этом интерфейсе',
                tutUiItems: [
                    'Сложность и Верификаторы: задают сложность головоломки и количество карточек-подсказок.',
                    'Новая игра: начинает новую головоломку. Решение: проверь свой ответ или сдайся и посмотри код.',
                    'Трик (необязательно): показывает скрытый паттерн и дополнительный анализ. Дальтонизм: меняет красный/зелёный на синий/оранжевый.',
                    'Слоты A B C: здесь выбираешь код. Передать ход: снова активирует верификаторов после 3 проверок.',
                    'Карточки верификаторов: на каждой — своя подсказка. Синий ? открывает гид по верификаторам; карандаш зачёркивает исключённые варианты.',
                    'Глаз на карточке означает, что подсказка ждёт раскрытия — нажми на карточку, чтобы перевернуть её.',
                    'История (справа): записывает каждый ход и его ответы.'
                ],
                difficultyOpts: ['Лёгкая', 'Средняя', 'Сложная'],
                levelContradiction: 'Сгенерированные проверки противоречат друг другу. Игра отменена — попробуйте снова.'
            },
            criteria: {
                'A = | > 1': { d: 'A против 1', o: ['= 1', '> 1'] },
                'A < | = | > 3': { d: 'A против 3', o: ['< 3', '= 3', '> 3'] },
                'B < | = | > 3': { d: 'B против 3', o: ['< 3', '= 3', '> 3'] },
                'B < | = | > 4': { d: 'B против 4', o: ['< 4', '= 4', '> 4'] },
                'A Even | Odd': { d: 'Чётность A', o: ['Чёт', 'Нечёт'] },
                'B Even | Odd': { d: 'Чётность B', o: ['Чёт', 'Нечёт'] },
                'C Even | Odd': { d: 'Чётность C', o: ['Чёт', 'Нечёт'] },
                '(0 1 2 3)x 1': { d: 'Количество цифр 1', o: ['0', '1', '2', '3'] },
                '(0 1 2 3)x 3': { d: 'Количество цифр 3', o: ['0', '1', '2', '3'] },
                '(0 1 2 3)x 4': { d: 'Количество цифр 4', o: ['0', '1', '2', '3'] },
                'A < | = | > B': { d: 'A против B', o: ['<', '=', '>'] },
                'A < | = | > C': { d: 'A против C', o: ['<', '=', '>'] },
                'B < | = | > C': { d: 'B против C', o: ['<', '=', '>'] },
                '(A < BC) | (B < AC) | (C < AB)': { d: 'Наименьшая цифра', o: ['A', 'B', 'C'] },
                '(A > BC) | (B > AC) | (C > AB)': { d: 'Наибольшая цифра', o: ['A', 'B', 'C'] },
                'Even > | < Odd': { d: 'Чётные против нечётных', o: ['Больше чётных', 'Больше нечётных'] },
                '(0 1 2 3)x Even': { d: 'Количество чётных', o: ['0', '1', '2', '3'] },
                '(A + B + C) Even | Odd': { d: 'Чётность суммы', o: ['Чёт', 'Нечёт'] },
                '(A + B) < | = | > 6': { d: 'A+B против 6', o: ['< 6', '= 6', '> 6'] },
                '(0/1 2 3)x X': { d: 'Повторы цифр', o: ['Нет', 'Одна пара', 'Три'] },
                'X X Y Yes | No': { d: 'Есть одна пара?', o: ['Да', 'Нет'] },
                '(A < B < C) | (A > B > C) | (A ? B ? C)': { d: 'Порядок A,B,C', o: ['Возрастание', 'Убывание', 'Никакой'] },
                '(A + B + C) < | = | > 6': { d: 'Сумма против 6', o: ['< 6', '= 6', '> 6'] },
                '(0 2 3) Increment': { d: 'Шаги +1', o: ['Нет', 'Один', 'Все'] },
                '(0 2 3) Increment/Decrement': { d: 'Шаги ±1', o: ['Нет', 'Один', 'Все'] },
                '(A | B | C) < 3': { d: 'Какая цифра < 3?', o: ['A', 'B', 'C'] },
                '(A | B | C) < 4': { d: 'Какая цифра < 4?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 1': { d: 'Какая цифра = 1?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 3': { d: 'Какая цифра = 3?', o: ['A', 'B', 'C'] },
                '(A | B | C) = 4': { d: 'Какая цифра = 4?', o: ['A', 'B', 'C'] },
                '(A | B | C) > 1': { d: 'Какая цифра > 1?', o: ['A', 'B', 'C'] },
                '(A | B | C) > 3': { d: 'Какая цифра > 3?', o: ['A', 'B', 'C'] },
                '(A | B | C) Even | Odd': { d: 'Какая чётная/нечётная?', o: ['A чёт', 'A нечёт', 'B чёт', 'B нечёт', 'C чёт', 'C нечёт'] },
                '(A <= BC) | (B <= AC) | (C <= AB)': { d: 'Наименьшая (равенство ок)', o: ['A', 'B', 'C'] },
                '(A >= BC) | (B >= AC) | (C >= AB)': { d: 'Наибольшая (равенство ок)', o: ['A', 'B', 'C'] },
                '(A + B + C) = 3x | 4x | 5x': { d: 'Сумма кратна', o: ['3', '4', '5'] },
                '(A + B) | (B + C) | (A + C) = 4': { d: 'Пара даёт в сумме 4', o: ['A+B', 'B+C', 'A+C'] },
                '(A + B) | (B + C) | (A + C) = 6': { d: 'Пара даёт в сумме 6', o: ['A+B', 'B+C', 'A+C'] },
                '(A | B | C) = | > 1': { d: 'Какая цифра 1 или > 1?', o: ['A', 'B', 'C'] },
                '(A | B | C) < | = | > 3': { d: 'Какая позиция против 3?', o: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
                '(A | B | C) < | = | > 4': { d: 'Какая позиция против 4?', o: ['A: <,=,>', 'B: <,=,>', 'C: <,=,>'] },
                '(A < | > BC) | (B < | > AC) | (C < | > AB)': { d: 'Наименьшая или наибольшая?', o: ['A мин', 'B мин', 'C мин', 'A макс', 'B макс', 'C макс'] },
                'A < | = | > (B | C)': { d: 'A против B или C', o: ['A<B', 'A=B', 'A>B', 'A<C', 'A=C', 'A>C'] },
                'B < | = | > (A | C)': { d: 'B против A или C', o: ['B<A', 'B=A', 'B>A', 'B<C', 'B=C', 'B>C'] },
                '(0 1 2 3)x 1 | 3': { d: 'Количество 1 или 3', o: ['1: 0-3', '3: 0-3'] },
                '(0 1 2 3)x 3 | 4': { d: 'Количество 3 или 4', o: ['3: 0-3', '4: 0-3'] },
                '(0 1 2 3)x 1 | 4': { d: 'Количество 1 или 4', o: ['1: 0-3', '4: 0-3'] },
                '(A | B | C) < | = | > (A | B | C)': { d: 'Сравнения A, B, C', o: ['A<B', 'A=B', 'A>B', 'B<C', 'B=C', 'B>C', 'A<C', 'A=C', 'A>C'] }
            }
        }
    };

    function t(key, vars) {
        var set = (I18N[currentLang] || I18N.en).ui;
        var s = set[key] !== undefined ? set[key] : key;
        if (vars) {
            for (var i = 0; i < vars.length; i++) {
                s = s.split('{' + i + '}').join(String(vars[i]));
            }
        }
        return s;
    }

    function setText(id, txt) {
        var el = document.getElementById(id);
        if (el) el.textContent = txt;
    }

    function fillStaticTexts() {
        var set = (I18N[currentLang] || I18N.en).ui;
        setText('language-label', set.language);
        setText('difficulty-label', set.difficulty);
        setText('verifiers-label', set.verifiers);
        setText('newgame', set.newgame);
        setText('solution', set.solution);
        setText('cheat-label', set.cheat);
        setText('colorblind-label', set.colorblind);
        setText('history-title', set.history);

        var helpBtn = document.getElementById('verifiers-help');
        if (helpBtn) helpBtn.title = set.verifiersHelp;

        var markBtn = document.getElementById('verifiers-mark');
        if (markBtn) markBtn.title = set.markModeTooltip;

        var tutBtn = document.getElementById('tutorial');
        if (tutBtn) {
            tutBtn.title = set.tutorial;
            tutBtn.setAttribute('aria-label', set.tutorial);
        }

        var langEl = document.getElementById('language');
        if (langEl) langEl.value = currentLang;

        var diffEl = document.getElementById('difficulty');
        if (diffEl && diffEl.options && diffEl.options.length) {
            for (var i = 0; i < diffEl.options.length && i < set.difficultyOpts.length; i++) {
                diffEl.options[i].textContent = set.difficultyOpts[i];
            }
        }
    }

    function applyLanguage() {
        fillStaticTexts();
        if (level) {
            buildVerifiersGrid();
            // Mark-mode red dots survive a language re-render
            for (var i = 0; i < level.length; i++) {
                syncMarkIndicator(i);
            }
            // Pending-reveal selection survives a language re-render
            for (var j = 0; j < level.length; j++) {
                var rel = document.getElementById('verifier-' + j);
                if (!rel) continue;
                if (selectedVerifiers[j]) {
                    rel.classList.add('pending-reveal');
                } else {
                    rel.classList.remove('pending-reveal');
                }
            }
            updateUI(false);
            renderHistory();
        }
        applyAppearance();
    }

    function setLang(lang) {
        if (!I18N[lang]) lang = 'en';
        currentLang = lang;
        storeSet(LANG_KEY, lang);
        if (document.documentElement) document.documentElement.lang = lang;
        applyLanguage();
    }

    // ============================================================
    // Appearance: light/dark theme + colorblind-friendly palette
    // ============================================================

    var THEME_KEY = 'tm-theme';
    var CB_KEY = 'tm-colorblind';

    function storeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function storeSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

    function applyAppearance() {
        var theme = storeGet(THEME_KEY) || 'dark';
        document.documentElement.dataset.theme = theme;
        var btn = document.getElementById('theme-toggle');
        if (btn) btn.textContent = theme === 'dark' ? t('lightTheme') : t('darkTheme');

        var cb = storeGet(CB_KEY) === '1';
        var cbEl = document.getElementById('colorblind');
        if (cbEl) cbEl.checked = cb;
        document.documentElement.dataset.cb = cb ? 'on' : 'off';
    }

    // ============================================================
    // Initialization
    // ============================================================

    function init() {
        pattern = patternLoad('35415515142114134332122414324522333512434243232141221424144145322413251212153542321431444215131254245545443551452213241235435242125244412532252422353411553222113521544155451524525453223342143334531124135133552151231344323112355331111312351313535455554513425432224335311445233442343115421433211325454523511423225514541315352543441341255314533234121214154132345534123253152354555');

        allCards = generateCards(pattern);

        cardNone = { name: 'xxx', card: [] };
        cardNone.card = Array(pattern.pattern.length);
        for (var fi = 0; fi < cardNone.card.length; fi++) {
            cardNone.card[fi] = true;
        }

        criterias = createAllCriteria(pattern);

        setupSlotButtons();

        document.getElementById('newgame').addEventListener('click', newGame);
        document.getElementById('solution').addEventListener('click', showSolution);
        document.getElementById('solution-modal-close').addEventListener('click', closeSolutionModalAsGiveUp);
        document.getElementById('solution-check').addEventListener('click', function () {
            if (gameOver) return;
            if (modalGuess === null || modalGuess[0] === 'x' || modalGuess[1] === 'x' || modalGuess[2] === 'x') {
                showToast(t('needFullCode'));
                return;
            }
            checkGuessSolution(modalGuess.slice());
        });
        document.getElementById('solution-newgame').addEventListener('click', function () {
            closeSolutionModal();
            newGame();
        });
        document.getElementById('pass-turn').addEventListener('click', function () {
            var cheatModeNow = document.getElementById('cheat').checked;
            var pending = Object.keys(selectedVerifiers).length > 0;
            if (!cheatModeNow && !revealedThisTurn && pending && !turnBlocked) {
                doReveal();
            } else {
                passTurn();
            }
        });
        document.getElementById('verifiers-help').addEventListener('click', openVerifiersHelp);
        document.getElementById('verifiers-help-close').addEventListener('click', closeVerifiersHelp);
        document.getElementById('verifiers-help-modal').addEventListener('click', function (e) {
            if (e.target === this) closeVerifiersHelp();
        });
        document.getElementById('tutorial').addEventListener('click', openTutorial);
        document.getElementById('tutorial-close').addEventListener('click', closeTutorial);
        document.getElementById('tutorial-gotit').addEventListener('click', closeTutorial);
        document.getElementById('tutorial-modal').addEventListener('click', function (e) {
            if (e.target === this) closeTutorial();
        });
        document.getElementById('verifiers-mark').addEventListener('click', toggleMarkMode);
        document.getElementById('verifiers-mark-close').addEventListener('click', closeVerifierMark);
        document.getElementById('verifiers-mark-modal').addEventListener('click', function (e) {
            if (e.target === this) closeVerifierMark();
        });
        document.getElementById('cheat').addEventListener('change', function () {
            updateUI(false);
        });

        document.getElementById('theme-toggle').addEventListener('click', function () {
            var theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = theme;
            this.textContent = theme === 'dark' ? t('lightTheme') : t('darkTheme');
            storeSet(THEME_KEY, theme);
        });

        document.getElementById('colorblind').addEventListener('change', function () {
            document.documentElement.dataset.cb = this.checked ? 'on' : 'off';
            storeSet(CB_KEY, this.checked ? '1' : '0');
        });

        var langSel = document.getElementById('language');
        if (langSel) {
            langSel.addEventListener('change', function () {
                setLang(this.value);
            });
        }

        setLang(storeGet(LANG_KEY) || 'en');
        newGame();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

