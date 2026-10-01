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

    // Turn-based game state (physical game rules: max 3 verifications per turn)
    var turnNumber = 1;
    var maxVerifications = 3;
    var verificationsUsed = 0;
    var turnBlocked = false;
    var turnCode = null;         // code locked for the current turn after first verification
    var verifiedIndices = {};    // verifier index -> result (true=green, false=red) this turn
    var turnResults = [];        // [{index, result}] verifications accumulated this turn
    var history = [];            // [{turn, code, verifications:[{index, result}]}] finalized when the turn passes

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
        var left = maxVerifications - verificationsUsed;
        var el = document.getElementById('verifications-left');
        if (el) {
            el.textContent = t('verifications', [left, maxVerifications]);
            el.className = 'badge ' + (turnBlocked ? 'badge-blocked' : (left > 0 ? '' : 'badge-blocked'));
        }

        var passBtn = document.getElementById('pass-turn');
        if (passBtn) {
            passBtn.disabled = false;
            passBtn.textContent = t('passTurn');
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

    // Clicking a verifier during normal play = verification (consumes 1 of 3).
    // Result is green if the tested code satisfies the secret answer of this criterion.
    function verifyVerifier(idx) {
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
            el.classList.remove('verified-green', 'verified-red', 'locked', 'expanded', 'blocked');
            var verdict = el.querySelector('.verifier-verdict');
            if (verdict) verdict.textContent = '';
            var answerEl = el.querySelector('.verifier-answer');
            if (answerEl) answerEl.className = 'verifier-answer neutral';
        }
    }

    function passTurn() {
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

            // Criterion name (human-readable) and its answer options
            var h = humanizeCriterion(v.name);
            var nameDiv = document.createElement('div');
            nameDiv.className = 'verifier-name';
            nameDiv.textContent = h.display;
            div.appendChild(nameDiv);

            if (h.opts.length > 0) {
                var optsDiv = document.createElement('div');
                optsDiv.className = 'verifier-opts';
                optsDiv.textContent = h.opts.join(' · ');
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
                    verifyVerifier(idx);
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
                        if (turnCode !== null || turnBlocked) return;
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
        turnNumber = 1;
        verificationsUsed = 0;
        turnBlocked = false;
        turnCode = null;
        verifiedIndices = {};
        turnResults = [];
        history = [];

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
        if (!level || level.length === 0) {
            showToast(t('levelGenFailed', [document.getElementById('verifiers').value]));
            return;
        }
        var s = solutions(level);
        selectedCode = [String(s[0].n[0]), String(s[0].n[1]), String(s[0].n[2])];

        // Update button states
        var slotIds = ['slot-a', 'slot-b', 'slot-c'];
        for (var i = 0; i < 3; i++) {
            var buttons = document.getElementById(slotIds[i]).querySelectorAll('.slot-btn');
            for (var b = 0; b < buttons.length; b++) {
                buttons[b].classList.remove('active');
                if (buttons[b].getAttribute('data-value') === selectedCode[i]) {
                    buttons[b].classList.add('active');
                }
            }
        }

        showToast(t('solutionFmt', [selectedCode.join('')]));
        updateLevelStatus(selectedCode.join(''));
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
                verifications: 'Verifications: {0}/{1}',
                history: 'History',
                noTurnsYet: 'No turns yet. Set a code and verify to start.',
                noVerifiersUsed: 'No verifiers used.',
                needFullCode: 'Select a full code (A, B and C) before verifying.',
                noMoreVerif: 'Verifications used up. Pass the turn.',
                yes: 'YES',
                no: 'NO',
                turnFmt: 'Turn {0} — Code {1}',
                solutionFmt: 'Solution: {0}',
                levelVerified: 'Level verified: unique solution {0}',
                levelGenFailed: 'Could not build a {0}-verifier level with this difficulty. New game aborted — try fewer verifiers or a lower difficulty.',
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
                verifications: 'Verificaciones: {0}/{1}',
                history: 'Historial',
                noTurnsYet: 'Aún no hay turnos. Elige un código y verifica para empezar.',
                noVerifiersUsed: 'Sin verificadores usados.',
                needFullCode: 'Selecciona un código completo (A, B y C) antes de verificar.',
                noMoreVerif: 'Verificaciones agotadas. Pasa el turno.',
                yes: 'SÍ',
                no: 'NO',
                turnFmt: 'Turno {0} — Código {1}',
                solutionFmt: 'Solución: {0}',
                levelVerified: 'Nivel verificado: solución única {0}',
                levelGenFailed: 'No se pudo generar un nivel con {0} verificadores en esta dificultad. Partida cancelada; prueba con menos verificadores o menor dificultad.',
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
                verifications: 'Vérifications : {0}/{1}',
                history: 'Historique',
                noTurnsYet: 'Aucun tour pour l\'instant. Choisissez un code et vérifiez pour commencer.',
                noVerifiersUsed: 'Aucun vérificateur utilisé.',
                needFullCode: 'Sélectionnez un code complet (A, B et C) avant de vérifier.',
                noMoreVerif: 'Vérifications épuisées. Passez le tour.',
                yes: 'OUI',
                no: 'NON',
                turnFmt: 'Tour {0} — Code {1}',
                solutionFmt: 'Solution : {0}',
                levelVerified: 'Niveau vérifié : solution unique {0}',
                levelGenFailed: 'Impossible de créer un niveau à {0} vérificateurs avec cette difficulté. Partie annulée — essayez moins de vérificateurs ou une difficulté plus faible.',
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
                verifications: 'Prüfungen: {0}/{1}',
                history: 'Verlauf',
                noTurnsYet: 'Noch keine Züge. Wähle einen Code und prüfe, um zu starten.',
                noVerifiersUsed: 'Keine Prüfer verwendet.',
                needFullCode: 'Wähle zuerst einen vollständigen Code (A, B und C).',
                noMoreVerif: 'Prüfungen aufgebraucht. Beende den Zug.',
                yes: 'JA',
                no: 'NEIN',
                turnFmt: 'Zug {0} — Code {1}',
                solutionFmt: 'Lösung: {0}',
                levelVerified: 'Niveau geprüft: eindeutige Lösung {0}',
                levelGenFailed: 'Konnte kein {0}-Prüfer-Niveau mit dieser Schwierigkeit erstellen. Spiel abgebrochen — versuche weniger Prüfer oder eine niedrigere Schwierigkeit.',
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
                verifications: 'Проверки: {0}/{1}',
                history: 'История',
                noTurnsYet: 'Ходов пока нет. Выберите код и проверьте, чтобы начать.',
                noVerifiersUsed: 'Проверки не использовались.',
                needFullCode: 'Выберите полный код (A, B и C) перед проверкой.',
                noMoreVerif: 'Проверки закончились. Завершите ход.',
                yes: 'ДА',
                no: 'НЕТ',
                turnFmt: 'Ход {0} — Код {1}',
                solutionFmt: 'Решение: {0}',
                levelVerified: 'Уровень проверен: уникальное решение {0}',
                levelGenFailed: 'Не удалось создать уровень с {0} проверками на этой сложности. Игра отменена — попробуйте меньше проверок или проще сложность.',
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
        document.getElementById('pass-turn').addEventListener('click', passTurn);
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
