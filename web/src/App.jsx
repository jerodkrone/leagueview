import { useEffect, useMemo, useState } from 'react'
import './App.css'

const LEAGUES = [
  { key: 'nahl', label: 'NAHL', url: './nahl.gaps.json' },
  { key: 'ushl', label: 'USHL', url: './ushl.gaps.json' },
]

const POSITIONS = [
  { key: 'all', label: 'All' },
  { key: 'F', label: 'Forward' },
  { key: 'D', label: 'Defense' },
  { key: 'G', label: 'Goalie' },
]

// Resolves aging counts for sort and card display.
// Always returns { count: number, counts: {F,D,G} }.
//
//  counts = aging_out.by_year[birthYear] ?? {F:0,D:0,G:0}
//  count  = sum(counts) if posKey='all', else counts[posKey]
export function getAgingInfo(team, birthYear, posKey) {
  const raw = team.aging_out.by_year?.[birthYear] ?? { F: 0, D: 0, G: 0 }
  const count = posKey === 'all'
    ? (raw.F + raw.D + raw.G)
    : (raw[posKey] ?? 0)
  return { count, counts: raw }
}

// Resolves returning counts for card display. Mirrors getAgingInfo.
//
// returning.by_year is cumulative-decreasing — "players still eligible AFTER
// the season ending in this year" — and sparse: a team only has keys for its
// own roster's age-out years. A missing year therefore resolves to the entry
// at the largest key at or below it (past the team's final year that entry is
// all zeros), NOT to the flat totals. The flat fallback remains only for
// legacy data with no usable by_year keys.
export function getReturningInfo(team, birthYear, posKey) {
  const byYear = team.returning.by_year ?? {}
  const nearestYear = Object.keys(byYear)
    .filter((y) => Number(y) <= Number(birthYear))
    .sort((a, b) => Number(b) - Number(a))[0]
  const raw = nearestYear ? byYear[nearestYear] : team.returning
  const count = posKey === 'all'
    ? (raw.F + raw.D + raw.G)
    : (raw[posKey] ?? 0)
  return { count, counts: raw }
}

// Derives available age-out years from loaded data, sorted ascending.
// Returns [] when no team has by_year data.
export function deriveAvailableYears(teams) {
  const years = new Set()
  teams.forEach((t) => Object.keys(t.aging_out.by_year || {}).forEach((y) => years.add(y)))
  return Array.from(years).sort((a, b) => Number(a) - Number(b))
}

function PositionPips({ counts, type, posKey }) {
  const color = type === 'aging' ? '#f97316' : '#38bdf8'
  const items = []
  for (let i = 0; i < counts.F; i++) items.push({ pos: 'F' })
  for (let i = 0; i < counts.D; i++) items.push({ pos: 'D' })
  for (let i = 0; i < counts.G; i++) items.push({ pos: 'G' })
  return (
    <div className="pips">
      {items.map((p, i) => {
        const active = posKey === 'all' || posKey === p.pos
        return (
          <span
            key={i}
            className="pip"
            style={{ background: active ? color : '#374151' }}
            title={p.pos}
          >
            {p.pos}
          </span>
        )
      })}
    </div>
  )
}

function TeamCard({ team, rank, posKey, agingCount, agingCounts, returningCount, returningCounts }) {
  return (
    <div className="card">
      <div className="card-rank">#{rank}</div>
      <div className="card-body">
        <div className="card-name">{team.team_name}</div>

        <div className="card-section">
          <div className="card-label">Aging out</div>
          <div className="card-count aging">{agingCount}</div>
          <PositionPips counts={agingCounts} type="aging" posKey={posKey} />
        </div>

        <div className="card-section">
          <div className="card-label">Returning</div>
          <div className="card-count returning">{returningCount}</div>
          <PositionPips counts={returningCounts} type="returning" posKey={posKey} />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [league, setLeague] = useState(LEAGUES[0])
  const [pos, setPos] = useState(POSITIONS[0])
  const [birthYear, setBirthYear] = useState(() => {
    const stored = localStorage.getItem('leagueview-age-out-year')
    return /^\d{4}$/.test(stored) ? stored : null
  })
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [byYearMissing, setByYearMissing] = useState(false)

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError(null)
    fetch(league.url)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then((d) => {
        if (!ignore) {
          setData(d)
          setLoading(false)
          // Resolve the active year now that this league's data has loaded:
          // keep the current year if it's still valid here, else default to
          // the soonest available one. No valid year anywhere -> hide the filter.
          const years = deriveAvailableYears(d.teams)
          setByYearMissing(years.length === 0)
          const resolved = birthYear && years.includes(birthYear) ? birthYear : (years[0] ?? null)
          setBirthYear(resolved)
          if (resolved) localStorage.setItem('leagueview-age-out-year', resolved)
        }
      })
      .catch((e) => { if (!ignore) { setError(e.message); setLoading(false) } })
    return () => { ignore = true }
  }, [league]) // eslint-disable-line react-hooks/exhaustive-deps

  function switchLeague(l) {
    setLeague(l)
    setPos(POSITIONS[0])
  }

  function selectBirthYear(y) {
    setBirthYear(y)
    localStorage.setItem('leagueview-age-out-year', y)
  }

  const availableYears = useMemo(
    () => (data ? deriveAvailableYears(data.teams) : []),
    [data]
  )

  if (error) return <div className="state-msg">Failed to load data: {error}</div>
  if (!data) return <div className="state-msg">Loading…</div>

  const scraped = new Date(data.scraped_at)
  const scrapeLabel = scraped.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })

  const sorted = [...data.teams]
    .sort((a, b) => {
      const aInfo = getAgingInfo(a, birthYear, pos.key)
      const bInfo = getAgingInfo(b, birthYear, pos.key)
      return bInfo.count - aInfo.count
    })

  const showYearChips = availableYears.length > 0

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div>
            <h1 className="logo">AgeOuts</h1>
            <p className="tagline">{data.league_name} roster gaps · {data.season} season</p>
          </div>
          <div className="freshness">
            <span className="freshness-dot" />
            Updated {scrapeLabel}
          </div>
        </div>

        <div className="league-tabs" role="tablist">
          {LEAGUES.map((l) => (
            <button
              key={l.key}
              role="tab"
              aria-selected={league.key === l.key}
              className="league-tab"
              onClick={() => switchLeague(l)}
            >
              {l.label}
            </button>
          ))}
        </div>

        <p className="explainer">
          Teams ranked by active players aging out of eligibility — the most open
          spots for camp attendees next season. <strong>F</strong> = forward,{' '}
          <strong>D</strong> = defense, <strong>G</strong> = goalie.
        </p>
      </header>

      {byYearMissing && (
        <p className="by-year-notice">Age-out year data unavailable for this league</p>
      )}

      <div className="pos-filter" role="group" aria-label="Filter by position">
        {POSITIONS.map((p_) => (
          <button
            key={p_.key}
            className="pos-pill"
            aria-pressed={pos.key === p_.key}
            onClick={() => setPos(p_)}
          >
            {p_.label}
          </button>
        ))}
      </div>

      {showYearChips && (
        <div className="year-filter" role="group" aria-label="Filter by age-out year">
          {availableYears.map((y) => (
            <button
              key={y}
              className="year-pill"
              aria-pressed={birthYear === y}
              onClick={() => selectBirthYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      <main className="grid" style={{ opacity: loading ? 0.4 : 1 }}>
        {sorted.map((team, i) => {
          const { count, counts } = getAgingInfo(team, birthYear, pos.key)
          const { count: retCount, counts: retCounts } = getReturningInfo(team, birthYear, pos.key)
          return (
            <TeamCard
              key={team.team_id}
              team={team}
              rank={i + 1}
              posKey={pos.key}
              agingCount={count}
              agingCounts={counts}
              returningCount={retCount}
              returningCounts={retCounts}
            />
          )
        })}
      </main>

      <footer className="footer">
        Data sourced from {data.league_name} league API · not affiliated with {data.league_name}
      </footer>
    </div>
  )
}
