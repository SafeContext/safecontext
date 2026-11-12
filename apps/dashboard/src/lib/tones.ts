// What each result and policy column looks like (issue #96): the one place that maps them to
// colours. The colours themselves are tokens in `src/routes/layout.css`. Shared by the server
// and the browser, so no server-only imports.
import type { Tier } from '@safecontext/policy';
import type { EventResult } from '#lib/feed.ts';

/** mint = nothing found, lemon = hidden / make it vague, pink = blocked / never share. */
export type Tone = 'clean' | 'hidden' | 'blocked' | 'neutral';

export const RESULT_TONE: Record<EventResult, Tone> = {
	safe: 'clean',
	vague: 'hidden',
	blocked: 'blocked'
};

export const TIER_TONE: Record<Tier, Tone> = {
	green: 'clean',
	yellow: 'hidden',
	red: 'blocked'
};

/**
 * Tailwind classes per tone, written out in full so Tailwind finds them.
 * - `key`: small colour keys and bars (brand colour with a darker edge, add `border`)
 * - `chip`: result chips with text on them
 * - `row`: rows in a panel (soft fill, add `border`)
 * - `panel`: panel backgrounds (faint tint, add `border`)
 */
export const TONE_CLASSES: Record<Tone, { key: string; chip: string; row: string; panel: string }> =
	{
		clean: {
			key: 'border-clean-edge bg-clean',
			chip: 'bg-clean text-ink',
			row: 'border-clean-edge bg-clean-soft',
			panel: 'border-line bg-well'
		},
		hidden: {
			key: 'border-hidden-edge bg-hidden',
			chip: 'bg-hidden text-ink',
			row: 'border-hidden-soft-edge bg-hidden-soft hover:border-hidden-edge',
			panel: 'border-hidden-tint-edge bg-hidden-tint'
		},
		blocked: {
			key: 'border-blocked-edge bg-blocked',
			chip: 'bg-blocked text-ink',
			row: 'border-blocked-soft-edge bg-blocked-soft hover:border-blocked-edge',
			panel: 'border-blocked-tint-edge bg-blocked-tint'
		},
		neutral: {
			key: 'border-ink bg-ink',
			chip: 'bg-ink/8 text-ink',
			row: 'border-line bg-white hover:border-ink/30',
			panel: 'border-line bg-well'
		}
	};
