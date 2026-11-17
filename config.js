// Connection settings. The control token is a secret-text field, so
// Companion keeps it in the secrets store (never in exported configs).

export const DEFAULT_URL = 'https://timedeck.docfila.com'

export function getConfigFields() {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Where to find these',
			value:
				'In TimeDeck, open Outputs and links on a live event. The operator link ends in #join=DECK.TOKEN: the part before the dot is the deck id, the part after it is the control token. Anyone with the token can control the event.',
		},
		{
			type: 'textinput',
			id: 'url',
			label: 'TimeDeck server',
			width: 8,
			default: DEFAULT_URL,
		},
		{
			type: 'textinput',
			id: 'deck',
			label: 'Deck id',
			width: 4,
			default: '',
			regex: '/^[a-z0-9]{6,32}$/',
		},
		{
			type: 'secret-text',
			id: 'token',
			label: 'Control token',
			width: 12,
			default: '',
		},
		{
			type: 'textinput',
			id: 'timer',
			label: 'Follow timer id (blank: the active timer)',
			width: 6,
			default: '',
		},
		{
			type: 'number',
			id: 'stepMs',
			label: 'Default add/subtract step (ms)',
			width: 3,
			default: 60000,
			min: 1000,
			max: 3600000,
		},
		{
			type: 'checkbox',
			id: 'longPoll',
			label: 'Use long-poll when the server has it',
			width: 3,
			default: true,
		},
	]
}
