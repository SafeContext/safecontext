/** A flagged piece of text. Offsets are UTF-16 code unit indices into the input string. */
export type Span = {
	start: number;
	end: number;
	/** Policy data type id. Built-in rules use `BUILTIN_DATA_TYPE` ids from @safecontext/policy. */
	dataTypeId: string;
	source: 'rule' | 'list' | 'tagger' | 'llm';
	/** 0..1. Rules and exact list matches are 1. */
	confidence: number;
};

export interface Detector {
	readonly id: string;
	detect(text: string): Span[];
}
