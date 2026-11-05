/** A spoken word with its timing, in seconds relative to the caption element's start. */
export interface MotionWord {
	w: string;
	s: number;
	e: number;
}

/** A word with absolute timeline timing, as produced by transcription. */
export interface TimedWord {
	text: string;
	start: number;
	end: number;
}

export const MOTION_WORDS_PARAM = "motion.words";

export function encodeMotionWords({ words }: { words: MotionWord[] }): string {
	return JSON.stringify(
		words.map((word) => [word.w, round3(word.s), round3(word.e)]),
	);
}

export function decodeMotionWords({
	value,
}: {
	value: unknown;
}): MotionWord[] | null {
	if (typeof value !== "string" || value.length < 2) return null;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return null;
		const words: MotionWord[] = [];
		for (const item of parsed) {
			if (Array.isArray(item) && item.length >= 3) {
				words.push({ w: String(item[0]), s: Number(item[1]), e: Number(item[2]) });
			}
		}
		return words.length ? words : null;
	} catch {
		return null;
	}
}

/** Spread the words of `content` across `duration`, weighted by word length. */
export function spreadWordsEvenly({
	content,
	duration,
}: {
	content: string;
	duration: number;
}): MotionWord[] {
	const tokens = content.split(/\s+/).filter(Boolean);
	if (!tokens.length) return [];
	const weights = tokens.map((token) => 1 + token.length * 0.25);
	const total = weights.reduce((a, b) => a + b, 0);
	const usable = Math.max(0.2, duration - 0.25);
	let cursor = 0;
	return tokens.map((token, index) => {
		const length = (weights[index] / total) * usable;
		const word = { w: token, s: cursor, e: cursor + length };
		cursor += length;
		return word;
	});
}

/**
 * Give every word of a transcription segment an estimated time, weighted by
 * word length. Used when the speech model returns phrase-level timing only.
 */
export function wordsFromSegment({
	text,
	start,
	end,
}: {
	text: string;
	start: number;
	end: number;
}): TimedWord[] {
	return spreadWordsEvenly({ content: text, duration: Math.max(0.3, end - start) + 0.25 }).map(
		(word) => ({ text: word.w, start: start + word.s, end: start + word.e }),
	);
}

export interface MotionCaptionChunk {
	text: string;
	startTime: number;
	duration: number;
	words: MotionWord[];
}

/**
 * Group timed words into short caption chunks (max `maxWords` words / `maxChars`
 * characters), breaking early on punctuation and pauses — the same rules that
 * produced the sample video.
 */
export function buildMotionCaptionChunks({
	words,
	maxWords = 3,
	maxChars = 20,
	pauseBreak = 0.55,
}: {
	words: TimedWord[];
	maxWords?: number;
	maxChars?: number;
	pauseBreak?: number;
}): MotionCaptionChunk[] {
	const groups: TimedWord[][] = [];
	let current: TimedWord[] = [];
	for (const word of words) {
		const text = word.text.trim();
		if (!text) continue;
		const clean = { ...word, text };
		if (current.length) {
			const last = current[current.length - 1];
			const chars = current.reduce((n, w) => n + w.text.length + 1, 0) + text.length;
			if (
				current.length >= maxWords ||
				chars > maxChars ||
				clean.start - last.end > pauseBreak ||
				/[,.!?;:]$/.test(last.text)
			) {
				groups.push(current);
				current = [];
			}
		}
		current.push(clean);
	}
	if (current.length) groups.push(current);

	return groups.map((group, index) => {
		const start = Math.max(0, group[0].start - 0.05);
		const next = groups[index + 1];
		const naturalEnd = Math.max(group[group.length - 1].end, group[group.length - 1].start + 0.35) + 0.7;
		const end = next ? Math.min(next[0].start - 0.05, naturalEnd) : naturalEnd;
		const duration = Math.max(0.3, end - start);
		return {
			text: group.map((w) => w.text).join(" "),
			startTime: start,
			duration,
			words: group.map((w) => ({ w: w.text, s: w.start - start, e: w.end - start })),
		};
	});
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}
