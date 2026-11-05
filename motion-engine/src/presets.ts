export type MotionPresetId =
	| "none"
	| "captions-box"
	| "captions-pop"
	| "headline"
	| "chips"
	| "terminal"
	| "checklist"
	| "stamp"
	| "flow"
	| "marquee"
	| "bigword"
	| "progress"
	| "rec"
	| "lower-third"
	| "chapter"
	| "wedding"
	| "glitch"
	| "word-swap"
	| "location"
	| "counter"
	| "list"
	| "versus"
	| "notification"
	| "chat"
	| "cta"
	| "highlight"
	| "strike"
	| "quote"
	| "arrow"
	| "lottie";

export type MotionCategory = "titles" | "info" | "social" | "emphasis" | "captions" | "lottie";

export const MOTION_CATEGORIES: Array<{ id: MotionCategory; label: string; hint: string }> = [
	{ id: "titles", label: "Titles", hint: "Openers, chapter cards and big statements." },
	{ id: "info", label: "Info", hint: "Names, places, numbers, lists and comparisons." },
	{ id: "social", label: "Social", hint: "Phone UI: notifications, chats, follow buttons, code windows." },
	{ id: "emphasis", label: "Emphasis", hint: "Point at, mark up or punctuate what you're saying." },
	{ id: "captions", label: "Caption styles", hint: "Generate from speech in the Captions tab, or switch any text's Motion Preset to one of these." },
];

export interface MotionPreset {
	id: Exclude<MotionPresetId, "none">;
	label: string;
	description: string;
	/** Default content. Lines are the template's slots; see CONTENT_HELP. */
	content: string;
	durationSeconds: number;
	/** Text size, in the editor's font-size units (same scale as text elements). */
	fontSize: number;
	/** Vertical anchor as a fraction of canvas height, measured from the centre (-0.5 = top edge). */
	anchorY: number;
	anchorX?: number;
	help: string;
	category: MotionCategory;
	/** Default accent colour (falls back to the brand orange). */
	accent?: string;
}

export const MOTION_PRESETS: MotionPreset[] = [
	{
		id: "headline",
		category: "titles",
		label: "Kinetic headline",
		description: "Letters rise in with a kicker and a serif accent line",
		content: "// testing, testing\nEDIT VIDEO\n~guna Claude",
		durationSeconds: 4,
		fontSize: 7,
		anchorY: -0.28,
		help: "One line per row. Start a line with // for a small code-style kicker, ~ for an orange italic accent line. Add @1.5 at the start of a line to make it enter 1.5 s in.",
	},
	{
		id: "chips",
		category: "info",
		label: "Chips",
		description: "Pill tags that slide in one by one",
		content: "// daily driver\n#HANYA 2 NI\nChatGPT\n*Claude\n@2.5 LLM lain → OpenRouter",
		durationSeconds: 5,
		fontSize: 7,
		anchorY: -0.28,
		help: "Each plain line is a chip. Start with * for an accent chip, # for a big title above, // for a kicker. Use @seconds to time a line, e.g. @2.5 DeepSeek.",
	},
	{
		id: "terminal",
		category: "social",
		label: "Terminal typewriter",
		description: "Code window that types your text",
		content: "whoami.sh\n> software engineer\n> pakai Claude hari-hari",
		durationSeconds: 5,
		fontSize: 7,
		anchorY: -0.26,
		help: "First line is the window title. Every following line is typed out in order.",
	},
	{
		id: "checklist",
		category: "social",
		label: "Todo checklist",
		description: "A todo.md card whose items tick off",
		content: "todo.md\n[x] record video ni\n[ ] test kat rumah\n[ ] figure out how",
		durationSeconds: 6,
		fontSize: 7,
		anchorY: -0.26,
		help: "First line is the card title. Items: [x] gets ticked during the animation, [ ] stays open. Use @seconds to time an item.",
	},
	{
		id: "stamp",
		category: "emphasis",
		label: "Stamp slam",
		description: "Rubber stamp that slams in and shakes",
		content: "EXPOSE!\n~coming soon",
		durationSeconds: 3,
		fontSize: 7,
		anchorY: -0.25,
		help: "Line 1 is stamped. Optional ~line underneath in serif italic.",
	},
	{
		id: "flow",
		category: "info",
		label: "Step diagram",
		description: "2–4 cards connected by arrows",
		content: "letak | footage\napp ni | buat kerja\nikut | style korang",
		durationSeconds: 7,
		fontSize: 7,
		anchorY: -0.26,
		help: "One step per line, written as small | big. Cards enter one after another; use @seconds to time each step. A // line adds a kicker.",
	},
	{
		id: "marquee",
		category: "titles",
		label: "Marquee",
		description: "Big scrolling repeated word",
		content: "AI IS\nEVERYWHERE",
		durationSeconds: 3.5,
		fontSize: 7,
		anchorY: -0.27,
		help: "Line 1 pops in on top. Line 2 scrolls in three rows (outline / solid / outline).",
	},
	{
		id: "bigword",
		category: "titles",
		label: "Giant word",
		description: "One huge word scales in under a serif lead-in",
		content: "~Berkenaan dengan\nAI",
		durationSeconds: 5,
		fontSize: 7,
		anchorY: -0.26,
		help: "~line is the serif lead-in. The other line is shown huge in the accent colour.",
	},
	{
		id: "progress",
		category: "emphasis",
		label: "Speed bar",
		description: "Italic title with speed lines and a filling progress bar",
		content: "SPEED UP\n~the project",
		durationSeconds: 4.5,
		fontSize: 7,
		anchorY: -0.27,
		help: "Line 1 is the title, ~line is the label under the bar.",
	},
	{
		id: "rec",
		category: "social",
		label: "REC badge",
		description: "Blinking recording dot in the corner",
		content: "REC · TEST 001",
		durationSeconds: 6,
		fontSize: 7,
		anchorY: -0.44,
		anchorX: -0.28,
		help: "Text next to the blinking dot.",
	},
	{
		id: "chapter",
		category: "titles",
		label: "Chapter card",
		description: "Spaced-out label, a line that draws across, title rises in",
		content: "PART 01\nTOPIK AI",
		durationSeconds: 3.5,
		fontSize: 7,
		anchorY: -0.26,
		help: "Line 1 is the small label (e.g. PART 01). The rest is the title.",
	},
	{
		id: "wedding",
		category: "titles",
		label: "Wedding title",
		description: "Elegant serif names fading in letter by letter, with a dated rule",
		content: "// the wedding of\nAriff & Sarah\n~02 . 11 . 2026",
		durationSeconds: 5,
		fontSize: 7,
		anchorY: -0.2,
		accent: "#d8b26e",
		help: "// line is the small spaced heading, the plain line is the names (& is drawn in the accent colour), ~line is the date between two rules.",
	},
	{
		id: "glitch",
		category: "titles",
		label: "Glitch",
		description: "RGB-split text with sliced glitch bursts",
		content: "ERROR 404\n~motivation not found",
		durationSeconds: 3.5,
		fontSize: 7,
		anchorY: -0.26,
		help: "Plain line glitches in. Optional ~line types out underneath.",
	},
	{
		id: "word-swap",
		category: "titles",
		label: "Word swap",
		description: "A fixed line with a slot below that cycles through words",
		content: "Claude boleh edit\nvideo\ngambar\ncode",
		durationSeconds: 4.5,
		fontSize: 7,
		anchorY: -0.26,
		help: "Line 1 stays. Each following line takes a turn in the accent box; the clip length is split between them.",
	},
	{
		id: "lower-third",
		category: "info",
		label: "Lower third",
		description: "Name and role bars wiping in beside an accent rule",
		content: "Ariff Hakimi\n~Software Engineer",
		durationSeconds: 4.5,
		fontSize: 7,
		anchorY: 0.3,
		help: "Line 1 is the name, ~line is the role. Sits on the left; move it with Position X/Y.",
	},
	{
		id: "location",
		category: "info",
		label: "Location pin",
		description: "Map pin drops and bounces, place name wipes out beside it",
		content: "Kuala Lumpur\n~Malaysia",
		durationSeconds: 4,
		fontSize: 7,
		anchorY: 0.3,
		help: "Line 1 is the place, ~line the smaller detail (country, venue, date).",
	},
	{
		id: "counter",
		category: "info",
		label: "Number counter",
		description: "Big number counts up, with a serif label",
		content: "10x\n~lebih laju",
		durationSeconds: 3.5,
		fontSize: 7,
		anchorY: -0.26,
		help: "The plain line holds the number — prefixes and suffixes are kept, e.g. RM 5,000 or 98.5%. ~line is the label, // a kicker.",
	},
	{
		id: "list",
		category: "info",
		label: "Numbered list",
		description: "Title plus numbered rows sliding in one by one",
		content: "#3 TIPS AI\nGuna prompt jelas\nBagi contoh\nSemak hasil",
		durationSeconds: 5,
		fontSize: 7,
		anchorY: -0.26,
		help: "#line is the title. Each other line is a numbered row; time rows with @seconds.",
	},
	{
		id: "versus",
		category: "info",
		label: "Versus",
		description: "Two cards slam in from the sides with a VS badge",
		content: "ChatGPT\nClaude",
		durationSeconds: 3.5,
		fontSize: 7,
		anchorY: -0.26,
		help: "Two lines: left and right. Add a subtitle with | e.g. Claude | daily driver. // adds a kicker.",
	},
	{
		id: "notification",
		category: "social",
		label: "Phone notification",
		description: "iOS-style banner drops in from the top",
		content: "Claude\nVideo kau dah siap 🎬\nTap untuk tengok",
		durationSeconds: 3.5,
		fontSize: 7,
		anchorY: -0.36,
		help: "Line 1 is the app name, line 2 the bold title, optional line 3 the message.",
	},
	{
		id: "chat",
		category: "social",
		label: "Chat bubbles",
		description: "Messages pop in one by one, with typing dots for replies",
		content: "> boleh edit video aku?\n< boleh! hantar je footage\n> serius?? 😳",
		durationSeconds: 5,
		fontSize: 7,
		anchorY: -0.22,
		help: "Start a line with > for your message (right, accent) or < for a reply (left, white). Replies show typing dots first. Use @seconds to time a message.",
	},
	{
		id: "cta",
		category: "social",
		label: "Follow button",
		description: "A cursor glides in and clicks a follow button",
		content: "FOLLOW\nFOLLOWING\n~untuk part 2",
		durationSeconds: 3.5,
		fontSize: 7,
		anchorY: 0.28,
		help: "Line 1 is the button text, line 2 the text after the click. ~line is a caption above.",
	},
	{
		id: "highlight",
		category: "emphasis",
		label: "Marker highlight",
		description: "Words rise in, then a marker sweeps behind the key words",
		content: "AI tak ganti kau, *AI* *bantu* kau",
		durationSeconds: 4,
		fontSize: 7,
		anchorY: -0.26,
		help: "Mark words to highlight with *asterisks*. Without any, the last word is highlighted.",
	},
	{
		id: "strike",
		category: "emphasis",
		label: "Strike-through",
		description: "Old idea gets crossed out, new one pops in",
		content: "Edit manual\nGuna AI",
		durationSeconds: 3.5,
		fontSize: 7,
		anchorY: -0.26,
		help: "Line 1 is struck out, line 2 replaces it.",
	},
	{
		id: "quote",
		category: "emphasis",
		label: "Quote",
		description: "Big quote mark, serif words fade in, attribution slides up",
		content: "AI is everywhere, dalam setiap lapisan kehidupan\n— Ariff",
		durationSeconds: 5,
		fontSize: 7,
		anchorY: -0.24,
		help: "The quote can span several lines. Start a line with — or - for the attribution.",
	},
	{
		id: "arrow",
		category: "emphasis",
		label: "Hand-drawn arrow",
		description: "A scribbled label and an arrow that draws itself",
		content: "ni dia!",
		durationSeconds: 3,
		fontSize: 7,
		anchorY: -0.05,
		help: "Points down-right. Drag it into place; set Scale X to -1 to point left, or rotate it.",
	},
	{
		id: "lottie",
		category: "lottie",
		label: "Lottie animation",
		description: "An imported Lottie (.json / .lottie) animation",
		content: "Lottie animation",
		durationSeconds: 2,
		fontSize: 7,
		anchorY: 0,
		help: "Import Lottie files in Motion → Lottie. Content is just the clip's label.",
	},
	{
		id: "captions-box",
		category: "captions",
		label: "Captions · highlight box",
		description: "Word-by-word captions, active word in an accent box",
		content: "ni adalah testing video",
		durationSeconds: 3,
		fontSize: 4,
		anchorY: -0.04,
		help: "Normally created from Captions → Animated. If typed by hand, words are spread evenly over the clip.",
	},
	{
		id: "captions-pop",
		category: "captions",
		label: "Captions · pop & colour",
		description: "Words pop in as spoken, active word turns accent",
		content: "ni adalah testing video",
		durationSeconds: 3,
		fontSize: 4,
		anchorY: -0.04,
		help: "Normally created from Captions → Animated. If typed by hand, words are spread evenly over the clip.",
	},
];

export const LOTTIE_LIBRARY_URL = "https://lottiefiles.com/free-animations";

export const MOTION_PRESET_OPTIONS: Array<{ value: MotionPresetId; label: string }> = [
	{ value: "none", label: "None (plain text)" },
	...MOTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
];

export function getMotionPreset({
	id,
}: {
	id: string;
}): MotionPreset | null {
	return MOTION_PRESETS.find((preset) => preset.id === id) ?? null;
}

export const DEFAULT_MOTION_ACCENT = "#ff6a2b";
export const DEFAULT_MOTION_INK = "#100e0e";
