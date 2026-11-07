// Links between the three sibling music apps. Each app ships its own copy;
// keep them identical.
const APPS = [
  { id: 'instrument-tuner', label: 'Tuner', icon: '♪' },
  { id: 'frequency-player', label: 'Tones', icon: '∿' },
  { id: 'pitch-tracker', label: 'Pitch', icon: '〽' },
] as const

export type SuiteApp = (typeof APPS)[number]['id']

export function SuiteNav({ current }: { current: SuiteApp }) {
  return (
    <nav className="suite" aria-label="Music tools">
      {APPS.map((app) =>
        app.id === current ? (
          <span key={app.id} className="suite__item suite__item--on" aria-current="page">
            <span aria-hidden="true">{app.icon}</span> {app.label}
          </span>
        ) : (
          <a key={app.id} className="suite__item" href={`https://ronpicard.github.io/${app.id}/`}>
            <span aria-hidden="true">{app.icon}</span> {app.label}
          </a>
        ),
      )}
    </nav>
  )
}
