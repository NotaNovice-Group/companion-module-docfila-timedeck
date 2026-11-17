// Presets: a transport row, time changes, a status display button and
// screen controls.
import { COLOURS } from './feedbacks.js'

const btn = (text, bgcolor = 0x18181b, color = COLOURS.white, size = '18') => ({ text, size, color, bgcolor, show_topbar: false })
const press = (actionId, options = {}) => [{ down: [{ actionId, options }], up: [] }]

export function updatePresets(self) {
	const v = (id) => `$(${self.label}:${id})`
	const transport = { timer: '__active' }
	const presets = {
		start: { type: 'simple', name: 'Start', style: btn('START'), steps: press('start', transport), feedbacks: [{ feedbackId: 'timer_phase', options: { phase: 'running' }, style: { bgcolor: COLOURS.normal, color: COLOURS.black } }] },
		pause: { type: 'simple', name: 'Pause', style: btn('PAUSE'), steps: press('pause', transport), feedbacks: [{ feedbackId: 'timer_phase', options: { phase: 'paused' }, style: { bgcolor: COLOURS.warning, color: COLOURS.black } }] },
		toggle: { type: 'simple', name: 'Start / pause', style: btn('START\\nPAUSE', 0x18181b, COLOURS.white, '14'), steps: press('toggle', transport), feedbacks: [{ feedbackId: 'timer_phase', options: { phase: 'running' }, style: { bgcolor: COLOURS.normal, color: COLOURS.black } }] },
		reset: { type: 'simple', name: 'Reset', style: btn('RESET'), steps: press('reset', transport), feedbacks: [] },
		restart: { type: 'simple', name: 'Restart', style: btn('RE-\\nSTART', 0x18181b, COLOURS.white, '14'), steps: press('restart', transport), feedbacks: [] },
		end: { type: 'simple', name: 'End', style: btn('END'), steps: press('end', transport), feedbacks: [{ feedbackId: 'timer_phase', options: { phase: 'ended' }, style: { bgcolor: COLOURS.overtime, color: COLOURS.white } }] },
		add_1m: { type: 'simple', name: 'Add 1 minute', style: btn('+1 MIN'), steps: press('add_time', { ms: 60000, timer: '__active' }), feedbacks: [] },
		sub_1m: { type: 'simple', name: 'Subtract 1 minute', style: btn('-1 MIN'), steps: press('subtract_time', { ms: 60000, timer: '__active' }), feedbacks: [] },
		add_30s: { type: 'simple', name: 'Add 30 seconds', style: btn('+30 S'), steps: press('add_time', { ms: 30000, timer: '__active' }), feedbacks: [] },
		status_display: {
			type: 'simple',
			name: 'Time and status',
			notes: 'Shows the time left and colours by status. Press to start or pause.',
			style: { text: `${v('time')}\\n${v('timer_name')}`, size: 'auto', color: COLOURS.white, bgcolor: 0x27272a, show_topbar: false },
			steps: press('toggle', transport),
			feedbacks: [{ feedbackId: 'status_colours', options: {} }],
		},
		status_word: {
			type: 'simple',
			name: 'Status word',
			style: { text: v('status'), size: '14', color: COLOURS.white, bgcolor: 0x27272a, show_topbar: false },
			steps: [],
			feedbacks: [{ feedbackId: 'status_colours', options: {} }],
		},
		next_session: {
			type: 'simple',
			name: 'Next session',
			style: { text: `NEXT\\n${v('next_session')}`, size: 'auto', color: COLOURS.white, bgcolor: 0x18181b, show_topbar: false },
			steps: [],
			feedbacks: [],
		},
		blackout: { type: 'simple', name: 'Blackout toggle', style: btn('BLACK\\nOUT', 0x18181b, COLOURS.white, '14'), steps: press('blackout', { mode: 'toggle' }), feedbacks: [{ feedbackId: 'blackout_on', options: {}, style: { bgcolor: COLOURS.white, color: COLOURS.black } }] },
		wrap_up: {
			type: 'simple',
			name: 'Message: wrap up',
			style: btn('WRAP\\nUP', 0x18181b, COLOURS.white, '14'),
			steps: press('send_message', { text: 'Please wrap up', tone: 'warning', style: 'banner', seconds: 0, audience: false }),
			feedbacks: [{ feedbackId: 'message_showing', options: {}, style: { bgcolor: COLOURS.blue, color: COLOURS.white } }],
		},
		clear_message: { type: 'simple', name: 'Message: clear', style: btn('CLEAR\\nMSG', 0x18181b, COLOURS.white, '14'), steps: press('clear_message'), feedbacks: [] },
	}
	const structure = [
		{
			id: 'transport',
			name: 'Transport',
			definitions: [
				{ id: 'transport_row', type: 'simple', name: 'Transport row', presets: ['start', 'pause', 'toggle', 'reset', 'restart', 'end'] },
				{ id: 'time_changes', type: 'simple', name: 'Time changes', presets: ['add_1m', 'sub_1m', 'add_30s'] },
			],
		},
		{
			id: 'display',
			name: 'Display',
			definitions: [{ id: 'status', type: 'simple', name: 'Status', presets: ['status_display', 'status_word', 'next_session'] }],
		},
		{
			id: 'screens',
			name: 'Screens and messages',
			definitions: [{ id: 'screen_controls', type: 'simple', name: 'Screen controls', presets: ['blackout', 'wrap_up', 'clear_message'] }],
		},
	]
	self.setPresetDefinitions(structure, presets)
}
