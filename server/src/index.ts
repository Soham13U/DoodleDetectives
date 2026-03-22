// Your server code will go here

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

//Types
type PlayerId = string;
type RoomId = string;

type Player = {
    playerId: PlayerId;
    name: string;
    socketId: string;
};

enum Phase  {
    LOBBY = "LOBBY",
    DRAWING = "DRAWING",
    VIEW_GUESS = "VIEW_GUESS",
    REVEAL = "REVEAL",
    GAME_OVER = "GAME_OVER"
};

type StrokePoint = {
    x: number;
    y: number;
};

type Stroke = {
    strokeId: string;
    playerId: PlayerId;
    color: string;
    thickness: number;
    points: StrokePoint[];
};

type RoundScores = Record<PlayerId,{
    guesserPoints: number;
    drawerPoints: number;
    totalPoints: number;
}>;

type RoundData = {
    prompt: string[];
    correctWords: string[];
    assignments: Record<PlayerId, string>;
    slotIndices: Record<PlayerId, number>;
    guesses: Record<PlayerId, string[] | undefined>;
    strokeCounts: Record<PlayerId, number | undefined>;
    correctGuessOrder?: PlayerId[];
  };
  
  type PlayerRoundScore = {
    guesserPoints: number;
    drawerPoints: number;
    totalPoints: number;
  };

type RoomState = {
    roomId: RoomId;
    roomName: string;
    phase: Phase;
    players: Map<PlayerId,Player>;
    strokes: Stroke[];
    prompt: string[];
    correctWords: string[];
    assignments: Record<PlayerId,string>;
    slotIndices: Record<PlayerId,number>;
    guesses: Record<PlayerId,string[] | undefined>;
    strokeCounts: Record<PlayerId,number>;  
    scores: RoundScores | null;
    finishedDrawing: Record<PlayerId,boolean>;
    correctGuessOrder: PlayerId[];
    phaseStartTime: number | null;
    drawingTimeLimit: number;
    guessingTimeLimit: number;
    currentRound: number;
    maxRounds: number;
    maxPlayers: number;
    hostPlayerId: PlayerId | null;
    totalScores: Record<PlayerId, number>; // Accumulated total scores across all rounds

};
const rooms = new Map<RoomId, RoomState>();
const roomNameToId = new Map<string, RoomId>(); // Map room name to room ID
const MIN_PLAYERS_PER_ROOM = 2;
const MAX_PLAYERS_PER_ROOM = 6;
const MAX_POINTS_PER_CHUNK = 50;
const MAX_POINTS_PER_STROKE = 2000;
const MAX_CHUNKS_PER_SECOND = 30;

type Pos = "noun" | "verb" | "place" | "adjective";
type Tag =
    | "human"
    | "animal"
    | "vehicle"
    | "object"
    | "food"
    | "nature"
    | "building"
    | "tool"
    | "flying"
    | "water"
    | "indoor"
    | "outdoor";

type WordEntry = {
    word: string;
    pos: Pos;
    tags: Tag[];
    drawable: boolean;
    assignable: boolean;
    difficulty: 1 | 2 | 3;
};

type VerbRule = {
    word: string;
    subjectAnyOf: Tag[];
    objectAnyOf?: Tag[];
    placeAnyOf?: Tag[];
};

type SlotSpec = {
    id: string;
    pos: Pos;
    assignable: boolean;
    bannedWords?: string[];
    // Optional semantic constraints to keep prompts coherent.
    requiredTagsAnyOf?: Tag[];
    // For verbs: pick a verb compatible with the tags of another chosen noun slot.
    verbSubjectAnchorSlotId?: string;
    // For verbs: pick a verb compatible with these subject tags even if no noun slot exists (e.g., "a person").
    verbSubjectRequiredTags?: Tag[];
    // Optional: restrict verb by whether its typical place matches these tags (useful for "from the ___" phrases).
    verbPlaceAnyOfRequiredTags?: Tag[];
    // Optional: restrict a verb slot to specific verbs for better phrasing (e.g. "from the ___" -> watching).
    allowedVerbWords?: string[];
};

type PromptToken = {
    type: "text" | "slot";
    value: string;
};

type Template = {
    id: string;
    minPlayers: number;
    maxPlayers: number;
    requiredAssignableCount: number;
    slots: SlotSpec[];
    tokens: PromptToken[];
};

type GeneratedPrompt = {
    templateId: string;
    promptTokens: string[];
    resolvedTokens: string[];
    correctWordsInSlotOrder: string[];
    slotIdsInOrder: string[];
};

function getActivePlayerIds(room: RoomState): PlayerId[] {
    return Array.from(room.players.values())
      .filter((p) => p.socketId && p.socketId !== "")
      .map((p) => p.playerId);
}

function getOrAssignHostPlayerId(room: RoomState): PlayerId | undefined {
    if (room.hostPlayerId) {
        const currentHost = room.players.get(room.hostPlayerId);
        if (currentHost && currentHost.socketId && currentHost.socketId !== "") {
            return room.hostPlayerId;
        }
    }
    const nextHostId = getActivePlayerIds(room)[0];
    room.hostPlayerId = nextHostId ?? null;
    return nextHostId;
}

function makeId(prefix: string):string{
    const randomValue = Math.random().toString(36).slice(2,10);
    const randomString = prefix+'_'+randomValue;
    return randomString;
}

const COLOR_DENYLIST = [
    "red", "green", "blue", "yellow", "black", "white", "purple", "orange", "pink", "brown",
];

const WORD_BANK: WordEntry[] = [
    { word: "firefighter", pos: "noun", tags: ["human", "tool"], drawable: true, assignable: true, difficulty: 2 },
    { word: "chef", pos: "noun", tags: ["human", "food"], drawable: true, assignable: true, difficulty: 1 },
    { word: "pirate", pos: "noun", tags: ["human"], drawable: true, assignable: true, difficulty: 1 },
    { word: "wizard", pos: "noun", tags: ["human"], drawable: true, assignable: true, difficulty: 2 },
    { word: "astronaut", pos: "noun", tags: ["human"], drawable: true, assignable: true, difficulty: 2 },
    { word: "cat", pos: "noun", tags: ["animal"], drawable: true, assignable: true, difficulty: 1 },
    { word: "dog", pos: "noun", tags: ["animal"], drawable: true, assignable: true, difficulty: 1 },
    { word: "bird", pos: "noun", tags: ["animal", "flying"], drawable: true, assignable: true, difficulty: 1 },
    { word: "dragon", pos: "noun", tags: ["animal", "flying"], drawable: true, assignable: true, difficulty: 2 },
    { word: "airplane", pos: "noun", tags: ["vehicle", "flying"], drawable: true, assignable: true, difficulty: 1 },
    { word: "bicycle", pos: "noun", tags: ["vehicle"], drawable: true, assignable: true, difficulty: 1 },
    { word: "rocket", pos: "noun", tags: ["vehicle", "flying"], drawable: true, assignable: true, difficulty: 2 },
    { word: "pizza", pos: "noun", tags: ["food", "object"], drawable: true, assignable: true, difficulty: 1 },
    { word: "kitten", pos: "noun", tags: ["animal"], drawable: true, assignable: true, difficulty: 1 },
    { word: "treasure", pos: "noun", tags: ["object"], drawable: true, assignable: true, difficulty: 1 },
    { word: "map", pos: "noun", tags: ["object"], drawable: true, assignable: true, difficulty: 1 },
    { word: "flag", pos: "noun", tags: ["object"], drawable: true, assignable: true, difficulty: 1 },
    { word: "hose", pos: "noun", tags: ["tool", "object"], drawable: true, assignable: true, difficulty: 1 },
    { word: "ladder", pos: "noun", tags: ["tool", "object"], drawable: true, assignable: true, difficulty: 1 },
    { word: "fence", pos: "noun", tags: ["object"], drawable: true, assignable: true, difficulty: 1 },
    { word: "tree", pos: "noun", tags: ["nature"], drawable: true, assignable: true, difficulty: 1 },
    { word: "volcano", pos: "noun", tags: ["nature", "outdoor"], drawable: true, assignable: true, difficulty: 2 },
    { word: "fountain", pos: "noun", tags: ["outdoor", "object"], drawable: true, assignable: true, difficulty: 1 },
    { word: "tower", pos: "noun", tags: ["building"], drawable: true, assignable: true, difficulty: 2 },
    { word: "cave", pos: "noun", tags: ["outdoor", "nature"], drawable: true, assignable: true, difficulty: 1 },
    { word: "rescuing", pos: "verb", tags: ["human", "animal"], drawable: true, assignable: true, difficulty: 2 },
    { word: "cooking", pos: "verb", tags: ["human", "food"], drawable: true, assignable: true, difficulty: 1 },
    { word: "chasing", pos: "verb", tags: ["human", "animal"], drawable: true, assignable: true, difficulty: 1 },
    { word: "steering", pos: "verb", tags: ["human", "vehicle"], drawable: true, assignable: true, difficulty: 2 },
    { word: "floating", pos: "verb", tags: ["human", "flying"], drawable: true, assignable: true, difficulty: 1 },
    { word: "lifting", pos: "verb", tags: ["human", "object"], drawable: true, assignable: true, difficulty: 1 },
    { word: "dancing", pos: "verb", tags: ["human"], drawable: true, assignable: true, difficulty: 1 },
    { word: "sleeping", pos: "verb", tags: ["human", "animal"], drawable: true, assignable: true, difficulty: 1 },
    { word: "watching", pos: "verb", tags: ["human", "animal"], drawable: true, assignable: true, difficulty: 2 },
    { word: "holding", pos: "verb", tags: ["human", "animal"], drawable: true, assignable: true, difficulty: 2 },
    { word: "park", pos: "place", tags: ["outdoor", "nature"], drawable: true, assignable: true, difficulty: 1 },
    { word: "kitchen", pos: "place", tags: ["indoor"], drawable: true, assignable: true, difficulty: 1 },
    { word: "airport", pos: "place", tags: ["building", "outdoor"], drawable: true, assignable: true, difficulty: 2 },
    { word: "bridge", pos: "place", tags: ["outdoor", "building"], drawable: true, assignable: true, difficulty: 1 },
    { word: "river", pos: "place", tags: ["water", "outdoor", "nature"], drawable: true, assignable: true, difficulty: 1 },
    { word: "striped", pos: "adjective", tags: ["object"], drawable: true, assignable: false, difficulty: 2 },
];

const VERB_RULES: VerbRule[] = [
    { word: "rescuing", subjectAnyOf: ["human"], objectAnyOf: ["animal", "human"], placeAnyOf: ["indoor", "outdoor"] },
    { word: "cooking", subjectAnyOf: ["human"], objectAnyOf: ["food"], placeAnyOf: ["indoor"] },
    { word: "chasing", subjectAnyOf: ["human", "animal"], objectAnyOf: ["animal", "human"] },
    { word: "steering", subjectAnyOf: ["human"], objectAnyOf: ["vehicle"], placeAnyOf: ["outdoor"] },
    { word: "floating", subjectAnyOf: ["human", "animal"], placeAnyOf: ["outdoor"] },
    { word: "lifting", subjectAnyOf: ["human"], objectAnyOf: ["object", "tool"] },
    { word: "dancing", subjectAnyOf: ["human"] },
    { word: "sleeping", subjectAnyOf: ["human", "animal"], placeAnyOf: ["indoor", "outdoor"] },
    { word: "watching", subjectAnyOf: ["human", "animal"], placeAnyOf: ["indoor", "outdoor"] },
    { word: "holding", subjectAnyOf: ["human", "animal"], objectAnyOf: ["tool", "object"] },
];

const TEMPLATES: Template[] = [
    {
        id: "p2_subject_verb",
        minPlayers: 2,
        maxPlayers: 2,
        requiredAssignableCount: 2,
        slots: [
            { id: "subject", pos: "noun", assignable: true, bannedWords: COLOR_DENYLIST },
            { id: "verb", pos: "verb", assignable: true },
        ],
        tokens: [
            { type: "slot", value: "subject" },
            { type: "text", value: "is" },
            { type: "slot", value: "verb" },
        ],
    },
    {
        id: "p3_action_place",
        minPlayers: 3,
        maxPlayers: 3,
        requiredAssignableCount: 3,
        slots: [
            { id: "subject", pos: "noun", assignable: true },
            { id: "verb", pos: "verb", assignable: true },
            { id: "place", pos: "place", assignable: true },
        ],
        tokens: [
            { type: "text", value: "The" },
            { type: "slot", value: "subject" },
            { type: "text", value: "is" },
            { type: "slot", value: "verb" },
            { type: "text", value: "near the" },
            { type: "slot", value: "place" },
        ],
    },
    {
        id: "p4_subject_verb_object_place",
        minPlayers: 4,
        maxPlayers: 4,
        requiredAssignableCount: 4,
        slots: [
            { id: "subject", pos: "noun", assignable: true },
            { id: "verb", pos: "verb", assignable: true },
            { id: "object", pos: "noun", assignable: true },
            { id: "place", pos: "place", assignable: true },
        ],
        tokens: [
            { type: "text", value: "The" },
            { type: "slot", value: "subject" },
            { type: "text", value: "is" },
            { type: "slot", value: "verb" },
            { type: "text", value: "a" },
            { type: "slot", value: "object" },
            { type: "text", value: "at the" },
            { type: "slot", value: "place" },
        ],
    },
    {
        id: "p5_scene",
        minPlayers: 5,
        maxPlayers: 5,
        requiredAssignableCount: 5,
        slots: [
            { id: "subject", pos: "noun", assignable: true },
            { id: "verb", pos: "verb", assignable: true },
            { id: "object", pos: "noun", assignable: true },
            {
                id: "watchVerb",
                pos: "verb",
                assignable: true,
                allowedVerbWords: ["watching"],
                verbSubjectRequiredTags: ["human", "animal"],
            },
            { id: "place", pos: "place", assignable: true },
        ],
        tokens: [
            { type: "text", value: "The" },
            { type: "slot", value: "subject" },
            { type: "text", value: "is" },
            { type: "slot", value: "verb" },
            { type: "text", value: "a" },
            { type: "slot", value: "object" },
            { type: "text", value: "while a person is" },
            { type: "slot", value: "watchVerb" },
            { type: "text", value: "from the" },
            { type: "slot", value: "place" },
        ],
    },
    {
        id: "p6_full_scene",
        minPlayers: 6,
        maxPlayers: 6,
        requiredAssignableCount: 6,
        slots: [
            { id: "subject", pos: "noun", assignable: true },
            { id: "verb", pos: "verb", assignable: true },
            { id: "object", pos: "noun", assignable: true },
            { id: "helper", pos: "noun", assignable: true, requiredTagsAnyOf: ["human", "animal"] },
            {
                id: "holdVerb",
                pos: "verb",
                assignable: true,
                allowedVerbWords: ["holding"],
                verbSubjectAnchorSlotId: "helper",
            },
            { id: "tool", pos: "noun", assignable: true, requiredTagsAnyOf: ["tool", "object"] },
        ],
        tokens: [
            { type: "text", value: "The" },
            { type: "slot", value: "subject" },
            { type: "text", value: "is" },
            { type: "slot", value: "verb" },
            { type: "text", value: "a" },
            { type: "slot", value: "object" },
            { type: "text", value: "while a" },
            { type: "slot", value: "helper" },
            { type: "text", value: "is" },
            { type: "slot", value: "holdVerb" },
            { type: "text", value: "a" },
            { type: "slot", value: "tool" },
        ],
    },
];

function shuffleArray<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function hasAnyTag(tags: Tag[], required: Tag[]): boolean {
    return required.some((tag) => tags.includes(tag));
}

function isForbiddenAssignmentWord(word: string): boolean {
    return COLOR_DENYLIST.includes(word.trim().toLowerCase());
}

function getTemplatesForPlayerCount(playerCount: number): Template[] {
    return TEMPLATES.filter(
        (tpl) =>
            playerCount >= tpl.minPlayers &&
            playerCount <= tpl.maxPlayers &&
            tpl.requiredAssignableCount === playerCount
    );
}

function getAssignablePoolByPos(
    pos: Pos,
    usedWords: Set<string>,
    requiredTagsAnyOf?: Tag[]
): WordEntry[] {
    return WORD_BANK.filter((entry) => {
        if (entry.pos !== pos) return false;
        if (!entry.assignable || !entry.drawable) return false;
        if (usedWords.has(entry.word)) return false;
        if (isForbiddenAssignmentWord(entry.word)) return false;
        if (requiredTagsAnyOf && requiredTagsAnyOf.length > 0) {
            if (!hasAnyTag(entry.tags, requiredTagsAnyOf)) return false;
        }
        return true;
    });
}

function pickSubjectNoun(usedWords: Set<string>): WordEntry | null {
    const candidates = shuffleArray(getAssignablePoolByPos("noun", usedWords));
    return candidates[0] ?? null;
}

function pickVerbForSubject(subject: WordEntry, usedWords: Set<string>): { verb: WordEntry; rule: VerbRule } | null {
    const verbCandidates = shuffleArray(getAssignablePoolByPos("verb", usedWords));
    for (const verb of verbCandidates) {
        const rule = VERB_RULES.find((r) => r.word === verb.word);
        if (!rule) continue;
        if (!hasAnyTag(subject.tags, rule.subjectAnyOf)) continue;
        return { verb, rule };
    }
    return null;
}

function pickObjectForVerb(rule: VerbRule, usedWords: Set<string>): WordEntry | null {
    const nounCandidates = shuffleArray(getAssignablePoolByPos("noun", usedWords));
    if (!rule.objectAnyOf || rule.objectAnyOf.length === 0) {
        return nounCandidates[0] ?? null;
    }
    return nounCandidates.find((entry) => hasAnyTag(entry.tags, rule.objectAnyOf!)) ?? null;
}

function pickPlaceForVerb(rule: VerbRule, usedWords: Set<string>): WordEntry | null {
    const placeCandidates = shuffleArray(getAssignablePoolByPos("place", usedWords));
    if (!rule.placeAnyOf || rule.placeAnyOf.length === 0) {
        return placeCandidates[0] ?? null;
    }
    return placeCandidates.find((entry) => hasAnyTag(entry.tags, rule.placeAnyOf!)) ?? null;
}

function pickGenericByPos(
    pos: Pos,
    usedWords: Set<string>,
    requiredTagsAnyOf?: Tag[]
): WordEntry | null {
    const candidates = shuffleArray(getAssignablePoolByPos(pos, usedWords, requiredTagsAnyOf));
    return candidates[0] ?? null;
}

function pickVerbForSlot(
    slot: SlotSpec,
    usedWords: Set<string>,
    chosenBySlot: Map<string, WordEntry>
): WordEntry | null {
    // If allowedVerbWords is set, restrict to that set (for phrase-quality).
    const allowed = slot.allowedVerbWords?.map((w) => w.toLowerCase());

    let requiredSubjectTags: Tag[] | undefined = slot.verbSubjectRequiredTags;
    if (slot.verbSubjectAnchorSlotId) {
        const anchor = chosenBySlot.get(slot.verbSubjectAnchorSlotId);
        if (anchor) requiredSubjectTags = anchor.tags;
    }

    const requiredPlaceTags = slot.verbPlaceAnyOfRequiredTags;

    const candidates = shuffleArray(
        WORD_BANK.filter((entry) => {
            if (entry.pos !== "verb") return false;
            if (!entry.assignable || !entry.drawable) return false;
            if (usedWords.has(entry.word)) return false;
            if (isForbiddenAssignmentWord(entry.word)) return false;
            if (slot.requiredTagsAnyOf && slot.requiredTagsAnyOf.length > 0) {
                if (!hasAnyTag(entry.tags, slot.requiredTagsAnyOf)) return false;
            }
            if (allowed && allowed.length > 0) {
                return allowed.includes(entry.word.toLowerCase());
            }
            return true;
        })
    );

    for (const verb of candidates) {
        const rule = VERB_RULES.find((r) => r.word === verb.word);
        if (!rule) continue;

        if (requiredSubjectTags && requiredSubjectTags.length > 0) {
            if (!hasAnyTag(rule.subjectAnyOf, requiredSubjectTags)) continue;
        }

        if (requiredPlaceTags && requiredPlaceTags.length > 0) {
            if (!rule.placeAnyOf || rule.placeAnyOf.length === 0) continue;
            if (!hasAnyTag(rule.placeAnyOf, requiredPlaceTags)) continue;
        }

        return verb;
    }

    return null;
}

function fallbackPromptForPlayers(playerCount: number): GeneratedPrompt {
    const clamped = Math.max(MIN_PLAYERS_PER_ROOM, Math.min(MAX_PLAYERS_PER_ROOM, playerCount));
    const nounPool = shuffleArray(getAssignablePoolByPos("noun", new Set())).slice(0, clamped);
    const promptTokens: string[] = [];
    const resolvedTokens: string[] = [];
    const correctWordsInSlotOrder: string[] = [];
    const slotIdsInOrder: string[] = [];

    for (let i = 0; i < clamped; i++) {
        const word = nounPool[i]?.word ?? `word${i + 1}`;
        promptTokens.push("__");
        resolvedTokens.push(word);
        correctWordsInSlotOrder.push(word);
        slotIdsInOrder.push(`slot_${i}`);
        if (i < clamped - 1) {
            promptTokens.push("and");
            resolvedTokens.push("and");
        }
    }

    return {
        templateId: `fallback_${clamped}`,
        promptTokens,
        resolvedTokens,
        correctWordsInSlotOrder,
        slotIdsInOrder,
    };
}

function generatePromptForPlayers(playerCount: number): GeneratedPrompt {
    const templates = getTemplatesForPlayerCount(playerCount);
    const MAX_ATTEMPTS = 30;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const template = shuffleArray(templates)[0];
        if (!template) break;

        const usedWords = new Set<string>();
        const chosenBySlot = new Map<string, WordEntry>();
        const slotSpecById = new Map(template.slots.map((s) => [s.id, s]));

        let subjectEntry: WordEntry | null = null;
        let verbChoice: { verb: WordEntry; rule: VerbRule } | null = null;

        // Fill in dependency order.
        if (slotSpecById.has("subject")) {
            subjectEntry = pickSubjectNoun(usedWords);
            if (!subjectEntry) continue;
            usedWords.add(subjectEntry.word);
            chosenBySlot.set("subject", subjectEntry);
        }
        if (slotSpecById.has("verb")) {
            if (!subjectEntry) continue;
            verbChoice = pickVerbForSubject(subjectEntry, usedWords);
            if (!verbChoice) continue;
            usedWords.add(verbChoice.verb.word);
            chosenBySlot.set("verb", verbChoice.verb);
        }
        if (slotSpecById.has("object")) {
            const objectEntry = verbChoice
                ? pickObjectForVerb(verbChoice.rule, usedWords)
                : pickGenericByPos("noun", usedWords);
            if (!objectEntry) continue;
            usedWords.add(objectEntry.word);
            chosenBySlot.set("object", objectEntry);
        }
        if (slotSpecById.has("place")) {
            const placeEntry = verbChoice
                ? pickPlaceForVerb(verbChoice.rule, usedWords)
                : pickGenericByPos("place", usedWords);
            if (!placeEntry) continue;
            usedWords.add(placeEntry.word);
            chosenBySlot.set("place", placeEntry);
        }

        // Fill remaining slots generically by POS.
        let failed = false;
        for (const slot of template.slots) {
            if (chosenBySlot.has(slot.id)) continue;
            const candidate = slot.pos === "verb"
                ? pickVerbForSlot(slot, usedWords, chosenBySlot)
                : pickGenericByPos(slot.pos, usedWords, slot.requiredTagsAnyOf);
            if (!candidate) {
                failed = true;
                break;
            }
            usedWords.add(candidate.word);
            chosenBySlot.set(slot.id, candidate);
        }
        if (failed) continue;

        const promptTokens: string[] = [];
        const resolvedTokens: string[] = [];
        const correctWordsInSlotOrder: string[] = [];
        const slotIdsInOrder: string[] = [];

        for (const token of template.tokens) {
            if (token.type === "text") {
                promptTokens.push(token.value);
                resolvedTokens.push(token.value);
                continue;
            }

            const slotId = token.value;
            const slot = slotSpecById.get(slotId);
            const entry = chosenBySlot.get(slotId);
            if (!slot || !entry) {
                failed = true;
                break;
            }

            const isBannedInSlot =
                (slot.bannedWords ?? []).includes(entry.word.toLowerCase()) ||
                (slot.assignable && isForbiddenAssignmentWord(entry.word));
            if (isBannedInSlot) {
                failed = true;
                break;
            }

            if (slot.assignable) {
                promptTokens.push("__");
                correctWordsInSlotOrder.push(entry.word);
                slotIdsInOrder.push(slotId);
            } else {
                promptTokens.push(entry.word);
            }
            resolvedTokens.push(entry.word);
        }
        if (failed) continue;

        // Final uniqueness guard on assigned words.
        const uniqueAssigned = new Set(correctWordsInSlotOrder);
        if (uniqueAssigned.size !== correctWordsInSlotOrder.length) continue;

        return {
            templateId: template.id,
            promptTokens,
            resolvedTokens,
            correctWordsInSlotOrder,
            slotIdsInOrder,
        };
    }

    console.warn(`[prompt] Failed to generate constrained prompt for ${playerCount} players, using fallback`);
    return fallbackPromptForPlayers(playerCount);
}

function getOrCreateRoom(
    roomId: RoomId,
    roomName?: string,
    maxRounds: number = 3,
    maxPlayers: number = MAX_PLAYERS_PER_ROOM
): RoomState{
    let room = rooms.get(roomId);
   
   if(!room)
    {
        // Validate maxRounds (1-5, default 3)
        const validatedMaxRounds = Math.max(1, Math.min(5, maxRounds || 3));
        const validatedMaxPlayers = Math.max(MIN_PLAYERS_PER_ROOM, Math.min(MAX_PLAYERS_PER_ROOM, maxPlayers || MAX_PLAYERS_PER_ROOM));
        
        // Initial prompt (will be changed each round)
        const initialPrompt = generatePromptForPlayers(validatedMaxPlayers);

         room = {
            roomId,
            roomName: roomName || roomId, // Use provided name or fallback to roomId
            phase: Phase.LOBBY,
            players: new Map(),
            strokes: [],
            prompt: initialPrompt.promptTokens,
            correctWords: initialPrompt.correctWordsInSlotOrder,
            assignments: {},
            slotIndices: {},
            guesses: {},
            strokeCounts: {},
            scores: null,
            finishedDrawing: {},
            correctGuessOrder: [],
            phaseStartTime: null,
            drawingTimeLimit: 60000,
            guessingTimeLimit: 30000,
            currentRound: 0,
            maxRounds: validatedMaxRounds,
            maxPlayers: validatedMaxPlayers,
            hostPlayerId: null,
            totalScores: {},
        };
        rooms.set(roomId,room);
        // Store mapping from room name to room ID
        if (roomName) {
            roomNameToId.set(roomName.toLowerCase(), roomId);
        }
        console.log(`[getOrCreateRoom] Created room ${roomId} with ${validatedMaxRounds} rounds and maxPlayers=${validatedMaxPlayers}`);
    }
    return room;
}
function buildCorrectPromptString(room: RoomState): string
{
    const {prompt, correctWords} = room;
    let idx = 0;
    return prompt.map((slot)=>{
        if(slot === "__" || slot === "" )
        {
            const word = correctWords[idx] ?? "";
            idx += 1;
            return word;
        }
        return slot;
    })
    .join(" ");
}
function calculateDrawerPoints(
    playerWord: string,
    playerSlotIndex: number,
    allGuesses: Record<PlayerId, string[] | undefined>,
    playerId: PlayerId,
    strokeCount: number | undefined,
    minStrokesRequired = 10,
    totalAssignedPlayers = 2
  ): number {
    if (!strokeCount || strokeCount < minStrokesRequired) return 0;
  
    let correctCount = 0;
    for (const [otherId, guess] of Object.entries(allGuesses)) {
      if (otherId === playerId) continue;
      if (!guess || playerSlotIndex < 0 || playerSlotIndex >= guess.length) continue;
      if (guess[playerSlotIndex] === playerWord) correctCount++;
    }
    const maxDrawerPoints = Math.max(1, Math.min(5, totalAssignedPlayers - 1));
    return Math.min(maxDrawerPoints, correctCount);
  }


function calculateRoundScores(roundData: RoundData, minStrokesRequired = 10): RoundScores {
    const scores: RoundScores = {};
    const { assignments, slotIndices, guesses, strokeCounts, correctGuessOrder } = roundData;
    const order = correctGuessOrder ?? [];
  
    const totalAssignedPlayers = Object.keys(assignments).length;
    for (const playerId of Object.keys(assignments)) {
      // Guesser points based on order of correct guess:
      // 1st correct: 5 pts, 2nd: 4, 3rd: 3, 4th: 2, 5th+: 1
      const rankIndex = order.indexOf(playerId);
      const guesserPoints =
        rankIndex === -1 ? 0 : Math.max(1, 5 - rankIndex);
  
      const playerWord = assignments[playerId];
      const slotIndex = slotIndices[playerId];
      const strokes = strokeCounts[playerId] ?? 0;
  
      const drawerPoints = calculateDrawerPoints(
        playerWord,
        slotIndex,
        guesses,
        playerId,
        strokes,
        minStrokesRequired,
        totalAssignedPlayers
      );
  
      scores[playerId] = {
        guesserPoints,
        drawerPoints,
        totalPoints: guesserPoints + drawerPoints,
      };
    }
  
    return scores;
  }

function startNewRound(room: RoomState, autoStart: boolean = false): void {
    // Note: round counter is incremented BEFORE calling this function
    console.log(`[startNewRound] Starting round ${room.currentRound} for room ${room.roomId}, autoStart: ${autoStart}`);
    
    // Reset round-specific state
    room.strokes = [];
    room.assignments = {};
    room.slotIndices = {};
    room.guesses = {};
    room.strokeCounts = {};
    room.scores = null;
    room.finishedDrawing = {};
    room.correctGuessOrder = [];
    room.phaseStartTime = null;
    
    if (autoStart) {
        // Automatically start the DRAWING phase
        const playerIds = getActivePlayerIds(room);
        const newPrompt = generatePromptForPlayers(playerIds.length);
        room.prompt = newPrompt.promptTokens;
        room.correctWords = newPrompt.correctWordsInSlotOrder;
        console.log(
            `[startNewRound] Selected template=${newPrompt.templateId} prompt=${newPrompt.resolvedTokens.join(" ")}`
        );
        
        // Assign words to active players only
        playerIds.forEach((pid, idx) => {
            const wordIndex = idx;
            room.assignments[pid] = room.correctWords[wordIndex];
            room.slotIndices[pid] = wordIndex;
            room.strokeCounts[pid] = 0;
            room.finishedDrawing[pid] = false;
        });
        console.log(`[startNewRound] Assignments:`, room.assignments);
        
        room.phase = Phase.DRAWING;
        room.phaseStartTime = Date.now();
        room.strokes = [];
        room.guesses = {};
        room.scores = null;
        room.correctGuessOrder = [];
        
        const elapsed = Date.now() - room.phaseStartTime;
        const timeRemaining = Math.max(0, room.drawingTimeLimit - elapsed);
        
        console.log(`[startNewRound] Auto-starting DRAWING phase for round ${room.currentRound}`);
        io.to(room.roomId).emit("game:state", {
            roomId: room.roomId,
            phase: room.phase,
            prompt: room.prompt,
            assignments: room.assignments,
            slotIndices: room.slotIndices,
            timeRemaining,
            currentRound: room.currentRound,
            maxRounds: room.maxRounds,
            totalScores: room.totalScores,
        });
    } else {
        // Reset phase to LOBBY (for initial game start)
        room.phase = Phase.LOBBY;
        console.log(`[startNewRound] Round ${room.currentRound} initialized, phase set to LOBBY`);
    }
}

function accumulateScores(room: RoomState): void {
    if (!room.scores) {
        console.log(`[accumulateScores] No scores to accumulate for room ${room.roomId}`);
        return;
    }
    
    console.log(`[accumulateScores] Accumulating scores for room ${room.roomId}, round ${room.currentRound}`);
    console.log(`[accumulateScores] Round scores:`, JSON.stringify(room.scores, null, 2));
    console.log(`[accumulateScores] Current totalScores before accumulation:`, JSON.stringify(room.totalScores, null, 2));
    
    // Initialize totalScores for all players if needed
    for (const playerId of room.players.keys()) {
        if (!(playerId in room.totalScores)) {
            room.totalScores[playerId] = 0;
            console.log(`[accumulateScores] Initialized totalScore for player ${playerId} to 0`);
        }
    }
    
    // Add round scores to total scores
    for (const [playerId, roundScore] of Object.entries(room.scores)) {
        const oldTotal = room.totalScores[playerId] || 0;
        room.totalScores[playerId] = oldTotal + roundScore.totalPoints;
        console.log(`[accumulateScores] Player ${playerId}: ${oldTotal} + ${roundScore.totalPoints} = ${room.totalScores[playerId]}`);
    }
    
    console.log(`[accumulateScores] Final totalScores:`, JSON.stringify(room.totalScores, null, 2));
}

function getWinner(room: RoomState): PlayerId | null {
    console.log(`[getWinner] Finding winner for room ${room.roomId}`);
    console.log(`[getWinner] totalScores:`, JSON.stringify(room.totalScores, null, 2));
    
    if (Object.keys(room.totalScores).length === 0) {
        console.log(`[getWinner] No scores found, returning null`);
        return null;
    }
    
    let maxScore = -1;
    let winner: PlayerId | null = null;
    
    for (const [playerId, totalScore] of Object.entries(room.totalScores)) {
        console.log(`[getWinner] Checking player ${playerId} with score ${totalScore}`);
        if (totalScore > maxScore) {
            maxScore = totalScore;
            winner = playerId;
            console.log(`[getWinner] New leader: ${playerId} with score ${maxScore}`);
        }
    }
    
    console.log(`[getWinner] Winner: ${winner} with score ${maxScore}`);
    return winner;
}

  // Add a setInterval that runs every second



const app = express();
const PORT = 3020;
const httpServer = createServer(app);

const io = new Server(httpServer,{
    cors:{
        origin:"*"
    },
});

app.get('/',(req:express.Request,res:express.Response)=>{
    res.send("Drawing prac");   
});

io.on("connection",(socket)=>{
    console.log(`Connected socket: ${socket.id}`);
    
    let chunksWindowStart = Date.now();
    let chunksInWindow = 0;
    
    // Handle room creation
    socket.on("room:create", (payload: { name?: string, roomName?: string, maxRounds?: number, maxPlayers?: number }, ack?: (res: any) => void) => {
        const name = payload?.name?.trim();
        const roomName = payload?.roomName?.trim();
        let maxRounds = payload?.maxRounds;
        let maxPlayers = payload?.maxPlayers;

        if (!name) {
            ack?.({ ok: false, error: "NAME_REQUIRED" });
            return;
        }

        if (!roomName) {
            ack?.({ ok: false, error: "ROOM_NAME_REQUIRED" });
            return;
        }

        // Validate maxRounds (1-5, default 3)
        if (maxRounds === undefined || maxRounds === null) {
            maxRounds = 3;
        } else {
            maxRounds = Math.max(1, Math.min(5, parseInt(String(maxRounds)) || 3));
        }
        if (maxPlayers === undefined || maxPlayers === null) {
            maxPlayers = MAX_PLAYERS_PER_ROOM;
        } else {
            maxPlayers = Math.max(MIN_PLAYERS_PER_ROOM, Math.min(MAX_PLAYERS_PER_ROOM, parseInt(String(maxPlayers)) || MAX_PLAYERS_PER_ROOM));
        }

        // Check if room name already exists
        const normalizedRoomName = roomName.toLowerCase();
        if (roomNameToId.has(normalizedRoomName)) {
            ack?.({ ok: false, error: "ROOM_NAME_EXISTS" });
            return;
        }

        // Generate a unique room ID
        const roomId = makeId("room");
        
        // Create the room with the provided name, maxRounds, and maxPlayers
        const room = getOrCreateRoom(roomId, roomName, maxRounds, maxPlayers);

        // Create player as host
        const playerId = makeId("p");
        const player: Player = { playerId, name, socketId: socket.id };
        room.players.set(playerId, player);
        room.hostPlayerId = playerId;

        socket.data.playerId = playerId;
        socket.data.roomId = roomId;
        socket.join(roomId);

        // Send snapshot
        const snapshot = {
            roomId,
            roomName: room.roomName,
            phase: room.phase,
            players: Array.from(room.players.values()).map((p) => ({
                playerId: p.playerId,
                name: p.name,
            })),
            strokes: room.strokes,
            prompt: room.prompt,
            correctWords: room.correctWords,
            assignments: room.assignments,
            slotIndices: room.slotIndices,
            guesses: room.guesses,
            strokeCounts: room.strokeCounts,
            scores: room.scores,
            finishedDrawing: room.finishedDrawing,
            correctGuessOrder: room.correctGuessOrder,
            maxPlayers: room.maxPlayers,
        };

        ack?.({
            ok: true,
            player: { playerId, name, roomId, roomName: room.roomName, isHost: true },
            snapshot,
        });

        // Broadcast updated players list (host = first active player)
        const activeList = Array.from(room.players.values()).filter((p) => p.socketId && p.socketId !== "");
        const hostId = getOrAssignHostPlayerId(room);
        const activePlayers = activeList.map((p) => ({
                playerId: p.playerId,
                name: p.name,
            isHost: hostId === p.playerId,
            }));

        io.to(roomId).emit("room:players", {
            roomId,
            players: activePlayers,
        });
    });
    
    socket.on("player:join",(payload:{name?:string, roomId?: string, resumePlayerId?:string}, ack?:(res:any) => void)=>{
        const name = payload?.name?.trim();
        const roomId = payload?.roomId?.trim();
        const resumePlayerId = payload?.resumePlayerId?.trim();

        if(!name)
        {
            ack?.({ok: false, error: "NAME_REQUIRED"});
            return;
        }

        if (!roomId) {
            ack?.({ ok: false, error: "ROOM_ID_REQUIRED" });
            return;
        }

        const room = rooms.get(roomId);
        if (!room) {
            ack?.({ ok: false, error: "ROOM_NOT_FOUND" });
            return;
        }

        let player:  Player | undefined;
        let playerId: PlayerId;

        //reconnect logic
        if(resumePlayerId && room.players.has(resumePlayerId))
        {
            player = room.players.get(resumePlayerId)!;// '!' tells TypeScript "I know it exists"
            playerId = player.playerId;
            player.name = name;
            player.socketId = socket.id; // Restore socketId on reconnect
            console.log(`Player ${playerId} reconnected with socket ${socket.id}`);
        }
        else
        {
            if (room.phase !== Phase.LOBBY) {
                ack?.({ ok: false, error: "GAME_ALREADY_STARTED" });
                return;
            }
            // Count only actively connected players (non-empty socketId)
            const activeCount = Array.from(room.players.values())
              .filter((p) => p.socketId && p.socketId !== "").length;
            if(activeCount >= room.maxPlayers)
            {
                ack?.({ok: false, error:"ROOM_FULL", maxPlayers: room.maxPlayers});
                return;
            }
           
            playerId = makeId("p"); //Make id for new player
            player = {playerId,name,socketId: socket.id}; 
            room.players.set(playerId,player); // Add new player in the map
        }

        socket.data.playerId = playerId;
        socket.data.roomId = roomId;
        socket.join(roomId);

        // Compute timeRemaining for snapshot if we are in a timed phase
        let timeRemaining: number | undefined;
        if (room.phaseStartTime) {
          const elapsed = Date.now() - room.phaseStartTime;
          if (room.phase === Phase.DRAWING) {
            timeRemaining = Math.max(0, room.drawingTimeLimit - elapsed);
          } else if (room.phase === Phase.VIEW_GUESS) {
            timeRemaining = Math.max(0, room.guessingTimeLimit - elapsed);
          }
        }

        //snapshot
        const snapshot = {
          roomId,
          roomName: room.roomName,
          phase: room.phase,
          // convert map to array and only keep playerId and name
          players: Array.from(room.players.values()).map((p) => ({
            playerId: p.playerId,
            name: p.name,
          })),
          strokes: room.strokes,
          prompt: room.prompt,
          correctWords: room.correctWords,
          assignments: room.assignments,
          slotIndices: room.slotIndices,
          guesses: room.guesses,
          strokeCounts: room.strokeCounts,  
          scores: room.scores,
          finishedDrawing: room.finishedDrawing,
          correctGuessOrder: room.correctGuessOrder,
          timeRemaining,
          maxPlayers: room.maxPlayers,
        };

        //selects all sockets in socket.io room named roomId (different from game room, this is socket.io's rooms system)
        // Broadcast updated players list (only active players with valid socketId)
        const activeList2 = Array.from(room.players.values()).filter((p) => p.socketId && p.socketId !== "");
        const hostId2 = getOrAssignHostPlayerId(room);
        ack?.({
            ok: true,
            player: {playerId, name, roomId, roomName: room.roomName, isHost: hostId2 === playerId},
            snapshot,
        });
        const activePlayers = activeList2.map((p) => ({
            playerId: p.playerId,
            name: p.name,
          isHost: hostId2 === p.playerId,
          }));
        
        io.to(roomId).emit("room:players",{
            roomId,
            players: activePlayers,
        });
        
        // If game is in progress (not LOBBY), also send game:state to all players to sync strokes
        // This ensures that when a player reconnects, all players get the latest game state
        // BUT: During DRAWING phase, don't send strokes because players are still drawing
        // and local strokes might be ahead of server strokes
        if (room.phase !== Phase.LOBBY && room.phase !== Phase.DRAWING) {
          const timeRemaining = room.phaseStartTime 
            ? Math.max(0, room.guessingTimeLimit - (Date.now() - room.phaseStartTime))
            : room.guessingTimeLimit;
          
          io.to(roomId).emit("game:state", {
            roomId,
            phase: room.phase,
            prompt: room.prompt,
            strokes: room.strokes,
            timeRemaining: room.phaseStartTime ? timeRemaining : undefined,
            currentRound: room.currentRound,
            maxRounds: room.maxRounds,
            totalScores: room.totalScores,
          });
        }


    });

    // Leave room (only allowed in LOBBY) - removes player from room and broadcasts updated list
    socket.on("room:leave", (_payload: {}, ack?: (res: any) => void) => {
        const roomId = socket.data.roomId as RoomId | undefined;
        const playerId = socket.data.playerId as PlayerId | undefined;

        if (!roomId || !playerId) {
            ack?.({ ok: false, error: "NOT IN ROOM" });
            return;
        }

        const room = rooms.get(roomId);
        if (!room) {
            ack?.({ ok: false, error: "ROOM_NOT_FOUND" });
            return;
        }

        if (room.phase !== Phase.LOBBY) {
            ack?.({ ok: false, error: "INVALID PHASE" });
            return;
        }

        // Remove player from room state
        room.players.delete(playerId);
        if (room.hostPlayerId === playerId) {
            room.hostPlayerId = getActivePlayerIds(room)[0] ?? null;
        }
        delete room.assignments[playerId];
        delete room.slotIndices[playerId];
        delete room.guesses[playerId];
        delete room.strokeCounts[playerId];
        delete room.finishedDrawing[playerId];
        room.correctGuessOrder = room.correctGuessOrder.filter((pid) => pid !== playerId);
        delete room.totalScores[playerId];

        // Leave the socket.io room and clear socket data
        socket.leave(roomId);
        socket.data.playerId = undefined;
        socket.data.roomId = undefined;

        // If no players remain, delete room and free room name
        if (room.players.size === 0) {
            rooms.delete(roomId);
            if (room.roomName) {
                roomNameToId.delete(room.roomName.toLowerCase());
            }
            ack?.({ ok: true });
            return;
        }

        // Broadcast updated players list (only active players; everyone in lobby is active)
        const activeList3 = Array.from(room.players.values()).filter((p) => p.socketId && p.socketId !== "");
        const hostId3 = getOrAssignHostPlayerId(room);
        const activePlayers = activeList3.map((p) => ({
            playerId: p.playerId,
            name: p.name,
            isHost: hostId3 === p.playerId,
        }));

        io.to(roomId).emit("room:players", {
            roomId,
            players: activePlayers,
        });

        ack?.({ ok: true });
    });

    socket.on("game:start",(ack?:(res: any) => void)=>{
            const roomId = socket.data.roomId as RoomId | undefined;
            const playerId = socket.data.playerId as PlayerId | undefined;

            if(!roomId || !playerId)
            {
                ack?.({ok: false,error: "NOT IN ROOM"});
                return;
            }

            const room = getOrCreateRoom(roomId);

            if(room.phase !== Phase.LOBBY)
            {
                ack?.({ok:false, error:"INVALID_PHASE"});
                return;
            }
            
            const activePlayerIds = getActivePlayerIds(room);
            const hostId = getOrAssignHostPlayerId(room);
            if(playerId !== hostId)
            {
                ack?.({ok:false, error:"ONLY HOST CAN START"});
                return;
            }
            if(activePlayerIds.length < 2)
            {
                ack?.({ok: false, error:"NOT ENOUGH PLAYERS"});
                return;
            }

            // Initialize first round if needed
            if (room.currentRound === 0) {
                console.log(`[game:start] Initializing first round for room ${roomId}`);
                room.currentRound = 1;
                // Initialize totalScores for all players
                for (const playerId of room.players.keys()) {
                    room.totalScores[playerId] = 0;
                    console.log(`[game:start] Initialized totalScore for player ${playerId} to 0`);
                }
                console.log(`[game:start] Round 1 initialized, totalScores:`, JSON.stringify(room.totalScores, null, 2));
                
                // Select a dynamic prompt sized to active players for the first round
                const firstPrompt = generatePromptForPlayers(activePlayerIds.length);
                room.prompt = firstPrompt.promptTokens;
                room.correctWords = firstPrompt.correctWordsInSlotOrder;
                console.log(
                    `[game:start] Selected template=${firstPrompt.templateId} prompt=${firstPrompt.resolvedTokens.join(" ")}`
                );
            } else {
                // This shouldn't happen - game:start should only be called once
                console.log(`[game:start] WARNING: game:start called for round ${room.currentRound}, but rounds should auto-start`);
                ack?.({ok: false, error: "GAME_ALREADY_STARTED"});
                return;
            }

            room.assignments={};
            room.slotIndices={};
            room.finishedDrawing={};
            const playerIds = activePlayerIds;

           //assign words to players
            playerIds.forEach((pid,idx)=>{
                const wordIndex  = idx;
                room.assignments[pid] = room.correctWords[wordIndex];
                room.slotIndices[pid] = wordIndex;
                room.strokeCounts[pid] = 0;
                room.finishedDrawing[pid] = false;
            });
            console.log(`[game:start] Assignments:`, room.assignments);

            room.phase = Phase.DRAWING;
            room.phaseStartTime = Date.now();
            room.strokes=[];
            room.guesses={};
            room.scores = null;
            room.correctGuessOrder = [];

            const elapsed = Date.now() - room.phaseStartTime;
            const timeRemaining = Math.max(0, room.drawingTimeLimit - elapsed);
            
            io.to(roomId).emit("game:state",{
                roomId,
                phase: room.phase,
                prompt: room.prompt,
                assignments: room.assignments,
                slotIndices: room.slotIndices,
                timeRemaining,
                currentRound: room.currentRound,
                maxRounds: room.maxRounds,
                totalScores: room.totalScores,
            });
            ack?.({ok:true});

    });

    socket.on("stroke:begin",(payload:{strokeId?: string,color?: string, thickness?: number}, ack?:(res:any)=>void)=>{
        const roomId = socket.data.roomId as RoomId | undefined;
        const playerId = socket.data.playerId as PlayerId | undefined;

        if(!roomId || !playerId)
        {
            ack?.({ok: false, error:"NOT IN ROOM"});
            return;
        }
        const room = getOrCreateRoom(roomId);
        if(room.phase !== Phase.DRAWING)
        {
            ack?.({ok: false, error: "INVALID PHASE"});
            return;
        }

        const strokeId = payload.strokeId || makeId("stroke");
        const color = payload.color || "#000000";
        const thickness = Math.max(1, payload.thickness || 3);  // Ensure at least 1

        const stroke: Stroke ={
            strokeId,
            playerId,
            color,
            thickness,
            points: [],
        };

        room.strokes.push(stroke);
        ack?.({ ok: true, strokeId });
    });

    socket.on("stroke:points",(payload:{strokeId: string, points: StrokePoint[]},ack?:(res:any)=>void)=>{
        const roomId = socket.data.roomId as RoomId | undefined;
        const playerId = socket.data.playerId as PlayerId | undefined;
        if(!roomId || !playerId)
        {
            ack?.({ok: false, error:"NOT_IN_ROOM"});
            return;
        }
        const room = getOrCreateRoom(roomId);
        if(room.phase !== Phase.DRAWING)
        {
            ack?.({ok: false, error:"INVALID PHASE"});
            return;
        }

        const strokeId = payload.strokeId;
        const points = payload.points;
        if(!strokeId || points.length === 0)
        {
            ack?.({ok: false, error:"STROKE_ID_AND_POINTS_REQUIRED"});
            return;
        }

        const stroke = room.strokes.find((s)=> s.strokeId === strokeId && s.playerId === playerId);
        if(!stroke)
        {
            ack?.({ok: false, error:"STROKE_NOT_FOUND"});
            return;
        }

        // from points(StrokePoint) we check if any x or y value is not between 0 and 1 and other validity.
        const invalidPoint = points.find((p)=> p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || typeof p.x !== 'number' || isNaN(p.x) || !isFinite(p.x) || typeof p.y !== 'number' || isNaN(p.y) || !isFinite(p.y));
        if(invalidPoint)
        {
            ack?.({ok: false, error:"INVALID COORDINATES"});
            return;
        }

        const now = Date.now();
        if(now - chunksWindowStart >= 1000)
        {
            chunksWindowStart = now;
            chunksInWindow = 0;
        }
        if(chunksInWindow >= MAX_CHUNKS_PER_SECOND)
        {
            ack?.({ok: false, error: "RATE LIMITED"});
            return;
        }
        chunksInWindow += 1;

        if(points.length > MAX_POINTS_PER_CHUNK)
        {
            ack?.({ok: false, error:"TOO MANY POINTS IN CHUNK"});
            return;
        }

        if(stroke.points.length + points.length > MAX_POINTS_PER_STROKE)
        {
            ack?.({ok: false, error:"STROKE TOO LARGE"});
            return;
        }

        stroke.points.push(...points);
        room.strokeCounts[playerId]  = (room.strokeCounts[playerId] || 0) + points.length;

        ack?.({ ok: true });

    });

    socket.on("stroke:end",(payload:{strokeId: string}, ack?:(res:any)=>void)=>{
        const roomId = socket.data.roomId as RoomId | undefined;
        const playerId = socket.data.playerId as PlayerId | undefined;
        if(!roomId || !playerId)
        {
            ack?.({ok: false, error:"NOT IN ROOM"});
            return;
        }
        const room = getOrCreateRoom(roomId);
        if(room.phase !== Phase.DRAWING)
        {
            ack?.({ok: false, error:"INVALID PHASE"});
            return;
        }
        const strokeId = payload.strokeId;
        if(!strokeId)
        {
            ack?.({ok: false, error:"STROKE ID REQUIRED"});
            return;
        }

        const stroke = room.strokes.find((s)=> s.strokeId === strokeId && s.playerId === playerId);
        if(!stroke)
        {
            ack?.({ok: false, error:"STROKE NOT FOUND"});
            return;
        }
        ack?.({ ok: true });
    });

    socket.on("canvas:clear",(ack?:(res:any)=>void)=>{
        const roomId = socket.data.roomId as RoomId | undefined;
        const playerId = socket.data.playerId as PlayerId | undefined;
        if(!roomId || !playerId)
        {
            ack?.({ok: false, error:"NOT IN ROOM"});
            return;
        }
        const room = getOrCreateRoom(roomId);
        if(room.phase !== Phase.DRAWING)
        {
            ack?.({ok: false, error:"INVALID PHASE"});
            return;
        }
        //remove strokes for that particular player
        room.strokes = room.strokes.filter((s)=> playerId !== s.playerId);
        room.strokeCounts[playerId] = 0;

        io.to(roomId).emit("canvas:clear",{playerId});
        ack?.({ ok: true });
    });

    socket.on("drawing:finish",(ack?:(res:any)=>void)=>{
        const roomId = socket.data.roomId as RoomId | undefined;
        const playerId = socket.data.playerId as PlayerId | undefined;
        if(!roomId || !playerId)
        {
            ack?.({ok: false, error:"NOT IN ROOM"});
            return;
        }
        const room = getOrCreateRoom(roomId);
        if(room.phase !== Phase.DRAWING)
        {
            ack?.({ok: false, error:"INVALID PHASE"});
            return;
        }
        room.finishedDrawing[playerId] = true;
        const assignedIds = Object.keys(room.assignments); //Object.keys() extracts all the keys from an object, ex. const assignedIds = ["p1", "p2"];
        const allFinished = assignedIds.length > 0 && assignedIds.every((pid)=>room.finishedDrawing[pid]);

        if(allFinished)
        {
            room.phase = Phase.VIEW_GUESS;
            room.phaseStartTime = Date.now();
            const timeRemaining = room.guessingTimeLimit; // Full time since we just started
            
            io.to(roomId).emit("game:state",{
                roomId,
                phase: room.phase,
                prompt : room.prompt,
                strokes: room.strokes,
                timeRemaining,
                currentRound: room.currentRound,
                maxRounds: room.maxRounds,
                totalScores: room.totalScores,
            });
        }
        ack?.({ ok: true });
    });

    socket.on("guess:submit",(payload:{text:string},ack?:(res:any)=>void)=>{
        const roomId = socket.data.roomId as RoomId | undefined;
        const playerId = socket.data.playerId as PlayerId | undefined;
        if(!roomId || !playerId)
        {
            ack?.({ok: false, error:"NOT IN ROOM"});
            return;
        }
        const room = getOrCreateRoom(roomId);
        if(room.phase !== Phase.VIEW_GUESS)
        {
            ack?.({ok: false, error:"INVALID PHASE"});
            return;
        }
        if(!payload.text.trim())
        {
            ack?.({ok: false, error:"EMPTY GUESS"});
            return;
        }
        const normalizedGuess  =  payload.text.trim().replace(/\s+/g, " ").toLowerCase();
        const temp  = buildCorrectPromptString(room);
        const normalizedCorrect = temp.trim().replace(/\s+/g, " ").toLowerCase();


        const existingGuess = room.guesses[playerId];
        const alreadySolved = !!existingGuess && existingGuess.length === room.correctWords.length && existingGuess.every((w, idx) => w === room.correctWords[idx]);
        
        if(alreadySolved)
        {
            const player = room.players.get(playerId);

            const assignedIds = Object.keys(room.assignments);
            for (const pid of assignedIds) {
                const g = room.guesses[pid];
                const solved =
                  g &&
                  g.length === room.correctWords.length &&
                  g.every((w, idx) => w === room.correctWords[idx]);
                if (!solved) continue;
                const p = room.players.get(pid);
                if (!p?.socketId) continue;
                io.to(p.socketId).emit("chat:message", {
                  playerId,
                  name: player?.name ?? "Player",
                  text: payload.text,
                  isCorrect: false,
                });
              }
        
              ack?.({ ok: true, correct: false });
              return;
        }

        const isCorrect = normalizedGuess === normalizedCorrect;

        if(isCorrect)
        {
            room.guesses[playerId] = [...room.correctWords];
            if(!room.correctGuessOrder.includes(playerId))
            {
                room.correctGuessOrder.push(playerId);
            }
            
        }
        else if(!room.guesses[playerId] || room.guesses[playerId].length === 0)
            {
                room.guesses[playerId] = [];
            }
        
        const player  = room.players.get(playerId);
        io.to(roomId).emit("chat:message",{
            playerId,
            name: player?.name ?? "Player",
            text: isCorrect ? "" : payload.text,
            isCorrect,
        });
        ack?.({ ok: true, correct: isCorrect });

        if(room.phase === Phase.VIEW_GUESS)
        {
            const assignedIds = Object.keys(room.assignments);
            if(assignedIds.length > 0)
            {
                const allCorrect = assignedIds.every((pid)=>{
                    const g = room.guesses[pid];
                    return(
                        g && g.length === room.correctWords.length && g.every((w, idx) => w === room.correctWords[idx])
                    );
                });

                if(allCorrect)
                {
                    room.phase = Phase.REVEAL;
                    room.phaseStartTime = null;
                    const roundData : RoundData = {
                        prompt: room.prompt,
                        correctWords: room.correctWords,
                        assignments: room.assignments,
                        slotIndices: room.slotIndices,
                        guesses: room.guesses,
                        strokeCounts: room.strokeCounts,
                        correctGuessOrder: room.correctGuessOrder,
                    };

                    console.log(`[guess:submit] All players guessed correctly - Calculating scores for room ${roomId}, round ${room.currentRound}`);
                    room.scores = calculateRoundScores(roundData,10);
                    console.log(`[guess:submit] Calculated round scores:`, JSON.stringify(room.scores, null, 2));
                    
                    // Accumulate scores
                    accumulateScores(room);
                    
                    console.log(`[guess:submit] Emitting game:reveal for room ${roomId}, round ${room.currentRound}`);
                    io.to(roomId).emit("game:reveal", {
                        roomId,
                        prompt: room.prompt,
                        correctWords: room.correctWords,
                        assignments: room.assignments,
                        slotIndices: room.slotIndices,
                        guesses: room.guesses,
                        strokeCounts: room.strokeCounts,
                        scores: room.scores,
                        currentRound: room.currentRound,
                        maxRounds: room.maxRounds,
                        totalScores: room.totalScores,
                      });
                    
                    // Increment round first, then check if game is over
                    console.log(`[guess:submit] Current round: ${room.currentRound}, maxRounds: ${room.maxRounds}`);
                    room.currentRound += 1;
                    console.log(`[guess:submit] Incremented round to: ${room.currentRound}`);
                    
                    // Check if game is over
                    if (room.currentRound > room.maxRounds) {
                        console.log(`[guess:submit] Game over! Round ${room.currentRound} > maxRounds ${room.maxRounds}`);
                        // Game over - transition to GAME_OVER phase
                        room.phase = Phase.GAME_OVER;
                        const winnerId = getWinner(room);
                        const winner = winnerId ? room.players.get(winnerId) : null;
                        
                        console.log(`[guess:submit] Emitting game:gameOver with winner:`, winner);
                        io.to(roomId).emit("game:gameOver", {
                            roomId,
                            winner: winner ? { playerId: winner.playerId, name: winner.name } : null,
                            totalScores: room.totalScores,
                        });
                    } else {
                        console.log(`[guess:submit] Starting new round ${room.currentRound}`);
                        // Start new round automatically after delay
                        console.log(`[guess:submit] Scheduling auto-start for round ${room.currentRound} in 5 seconds`);
                        setTimeout(() => {
                            console.log(`[guess:submit] Auto-starting round ${room.currentRound}`);
                            startNewRound(room, true); // autoStart = true
                        }, 5000); // Wait 5 seconds before starting next round
                    }
                }
            }
        }





 

    });

    socket.on("guess:finish", (_payload: {}, ack?: (res: any) => void) => {
        const roomId = socket.data.roomId as RoomId | undefined;
        if (!roomId) {
          ack?.({ ok: false, error: "NOT_IN_ROOM" });
          return;
        }
        const room = getOrCreateRoom(roomId);
        if (room.phase !== Phase.VIEW_GUESS) {
          ack?.({ ok: false, error: "INVALID_PHASE" });
          return;
        }
    
        room.phase = Phase.REVEAL;
        room.phaseStartTime = null;
    
        const roundData: RoundData = {
          prompt: room.prompt,
          correctWords: room.correctWords,
          assignments: room.assignments,
          slotIndices: room.slotIndices,
          guesses: room.guesses,
          strokeCounts: room.strokeCounts,
          correctGuessOrder: room.correctGuessOrder,
        };
    
        console.log(`[guess:finish] Calculating scores for room ${roomId}, round ${room.currentRound}`);
        room.scores = calculateRoundScores(roundData, 10);
        console.log(`[guess:finish] Calculated round scores:`, JSON.stringify(room.scores, null, 2));
        
        // Accumulate scores
        accumulateScores(room);
    
        console.log(`[guess:finish] Emitting game:reveal for room ${roomId}, round ${room.currentRound}`);
        io.to(roomId).emit("game:reveal", {
          roomId,
          prompt: room.prompt,
          correctWords: room.correctWords,
          assignments: room.assignments,
          slotIndices: room.slotIndices,
          guesses: room.guesses,
          strokeCounts: room.strokeCounts,
          scores: room.scores,
          currentRound: room.currentRound,
          maxRounds: room.maxRounds,
          totalScores: room.totalScores,
        });
        
        // Increment round first, then check if game is over
        console.log(`[guess:finish] Current round: ${room.currentRound}, maxRounds: ${room.maxRounds}`);
        room.currentRound += 1;
        console.log(`[guess:finish] Incremented round to: ${room.currentRound}`);
        
        // Check if game is over
        if (room.currentRound > room.maxRounds) {
            console.log(`[guess:finish] Game over! Round ${room.currentRound} > maxRounds ${room.maxRounds}`);
            // Game over - transition to GAME_OVER phase
            room.phase = Phase.GAME_OVER;
            const winnerId = getWinner(room);
            const winner = winnerId ? room.players.get(winnerId) : null;
            
            console.log(`[guess:finish] Emitting game:gameOver with winner:`, winner);
            io.to(roomId).emit("game:gameOver", {
                roomId,
                winner: winner ? { playerId: winner.playerId, name: winner.name } : null,
                totalScores: room.totalScores,
            });
        } else {
            console.log(`[guess:finish] Starting new round ${room.currentRound}`);
            // Start new round automatically after delay
            console.log(`[guess:finish] Scheduling auto-start for round ${room.currentRound} in 5 seconds`);
            setTimeout(() => {
                console.log(`[guess:finish] Auto-starting round ${room.currentRound}`);
                startNewRound(room, true); // autoStart = true
            }, 5000); // Wait 5 seconds before starting next round
        }
    
        ack?.({ ok: true });
      });

    socket.on("game:returnToLobby", (ack?: (res: any) => void) => {
        const roomId = socket.data.roomId as RoomId | undefined;
        if (!roomId) {
            ack?.({ ok: false, error: "NOT_IN_ROOM" });
            return;
        }
        const room = rooms.get(roomId);
        if (!room) {
            ack?.({ ok: false, error: "ROOM_NOT_FOUND" });
            return;
        }
        
        if (room.phase !== Phase.GAME_OVER) {
            ack?.({ ok: false, error: "INVALID_PHASE" });
            return;
        }
        
        // Reset game state back to LOBBY
        room.phase = Phase.LOBBY;
        room.currentRound = 0;
        room.totalScores = {};
        room.strokes = [];
        room.assignments = {};
        room.slotIndices = {};
        room.guesses = {};
        room.strokeCounts = {};
        room.scores = null;
        room.finishedDrawing = {};
        room.correctGuessOrder = [];
        room.phaseStartTime = null;

        // In LOBBY we should only keep actively connected players in the roster.
        // Disconnected placeholders were useful for GAME_OVER display, but should not
        // appear once the host returns to lobby.
        for (const [pid, player] of room.players.entries()) {
            if (!player.socketId || player.socketId === "") {
                room.players.delete(pid);
            }
        }
        if (!room.hostPlayerId || !room.players.has(room.hostPlayerId)) {
            room.hostPlayerId = getActivePlayerIds(room)[0] ?? null;
        }
        
        io.to(roomId).emit("game:state", {
            roomId,
            phase: room.phase,
            prompt: room.prompt,
            currentRound: room.currentRound,
            maxRounds: room.maxRounds,
            totalScores: room.totalScores,
        });

        const activeList4 = Array.from(room.players.values()).filter((p) => p.socketId && p.socketId !== "");
        const hostId4 = getOrAssignHostPlayerId(room);
        const activePlayers = activeList4.map((p) => ({
            playerId: p.playerId,
            name: p.name,
            isHost: hostId4 === p.playerId,
        }));

        io.to(roomId).emit("room:players", {
            roomId,
            players: activePlayers,
        });
        
        ack?.({ ok: true });
    });

    socket.on("disconnect",(reason)=>{
        console.log(`Disconnected socket: ${socket.id} reason: ${reason}`);
        const playerId = socket.data.playerId as PlayerId | undefined;
         const roomId = socket.data.roomId as RoomId | undefined;
        if (playerId && roomId) {
            const room = rooms.get(roomId);
            if (room) {
              const player = room.players.get(playerId);
              if (player) {
                // Keep player in room but mark socketId as disconnected (empty string or null)
                // This allows them to reconnect and resume
                player.socketId = ""; // Mark as disconnected
                if (room.hostPlayerId === playerId) {
                  room.hostPlayerId = getActivePlayerIds(room)[0] ?? null;
                }
              }
              
              // Update socket.data to clear room info
              socket.data.playerId = undefined;
              socket.data.roomId = undefined;
              
              // Broadcast updated players list.
              // During VIEW_GUESS, REVEAL, and GAME_OVER phases we KEEP disconnected players
              // so that their existing drawings/canvases remain visible to others.
              const activeList5 = Array.from(room.players.values())
                .filter((p) => {
                  if (
                    room.phase === Phase.VIEW_GUESS ||
                    room.phase === Phase.REVEAL ||
                    room.phase === Phase.GAME_OVER
                  ) {
                    return true; // include all players, even if disconnected
                  }
                  // In other phases (e.g. LOBBY, DRAWING), only include actively connected players
                  return p.socketId && p.socketId !== "";
                });
              const hostId5 = getOrAssignHostPlayerId(room);
              const broadcastPlayers = activeList5.map((p) => ({
                  playerId: p.playerId,
                  name: p.name,
                isHost: hostId5 === p.playerId,
                }));

              io.to(roomId).emit("room:players", {
                roomId,
                players: broadcastPlayers,
              });
            }
          }
    });
})

setInterval(() => {
    for (const [roomId, room] of rooms.entries()) {
      if (!room.phaseStartTime) continue;
      
      let elapsed = Date.now() - room.phaseStartTime;
      
      if (room.phase === Phase.DRAWING && elapsed >= room.drawingTimeLimit) {
        // Force transition to VIEW_GUESS
        room.phase = Phase.VIEW_GUESS;
        room.phaseStartTime = Date.now();
        const timeRemaining = room.guessingTimeLimit; // Full time since we just started
        
        io.to(roomId).emit("game:state", { 
            roomId,
            phase: room.phase,
            prompt: room.prompt,
            strokes: room.strokes,
            timeRemaining,
            currentRound: room.currentRound,
            maxRounds: room.maxRounds,
            totalScores: room.totalScores,
        });
      } else if (room.phase === Phase.VIEW_GUESS) {
        // Recompute elapsed from the (possibly reset) phaseStartTime
        elapsed = Date.now() - room.phaseStartTime;
        if (elapsed < room.guessingTimeLimit) {
          continue;
        }
        // Force transition to REVEAL
        room.phase = Phase.REVEAL;
        room.phaseStartTime = null;
        
        const roundData: RoundData = {
          prompt: room.prompt,
          correctWords: room.correctWords,
          assignments: room.assignments,
          slotIndices: room.slotIndices,
          guesses: room.guesses,
          strokeCounts: room.strokeCounts,
          correctGuessOrder: room.correctGuessOrder,
        };
        
        console.log(`[timer] VIEW_GUESS timeout - Calculating scores for room ${roomId}, round ${room.currentRound}`);
        room.scores = calculateRoundScores(roundData, 10);
        console.log(`[timer] Calculated round scores:`, JSON.stringify(room.scores, null, 2));
        
        // Accumulate scores
        accumulateScores(room);
        
        console.log(`[timer] Emitting game:reveal for room ${roomId}, round ${room.currentRound}`);
        io.to(roomId).emit("game:reveal", {
          roomId,
          prompt: room.prompt,
          correctWords: room.correctWords,
          assignments: room.assignments,
          slotIndices: room.slotIndices,
          guesses: room.guesses,
          strokeCounts: room.strokeCounts,
          scores: room.scores,
          currentRound: room.currentRound,
          maxRounds: room.maxRounds,
          totalScores: room.totalScores,
        });
        
        // Increment round first, then check if game is over
        console.log(`[timer] Current round: ${room.currentRound}, maxRounds: ${room.maxRounds}`);
        room.currentRound += 1;
        console.log(`[timer] Incremented round to: ${room.currentRound}`);
        
        // Check if game is over
        if (room.currentRound > room.maxRounds) {
            console.log(`[timer] Game over! Round ${room.currentRound} > maxRounds ${room.maxRounds}`);
            // Game over - transition to GAME_OVER phase
            room.phase = Phase.GAME_OVER;
            const winnerId = getWinner(room);
            const winner = winnerId ? room.players.get(winnerId) : null;
            
            console.log(`[timer] Emitting game:gameOver with winner:`, winner);
            io.to(roomId).emit("game:gameOver", {
                roomId,
                winner: winner ? { playerId: winner.playerId, name: winner.name } : null,
                totalScores: room.totalScores,
            });
        } else {
            console.log(`[timer] Starting new round ${room.currentRound}`);
            // Start new round automatically after delay
            console.log(`[timer] Scheduling auto-start for round ${room.currentRound} in 5 seconds`);
            setTimeout(() => {
                console.log(`[timer] Auto-starting round ${room.currentRound}`);
                startNewRound(room, true); // autoStart = true
            }, 5000); // Wait 5 seconds before starting next round
        }
      }
    }
  }, 1000); // Check every second






httpServer.listen(PORT, ()=>{
    console.log(`server listening on port :${PORT} `);
});


