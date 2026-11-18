import { type TicketStats, spell } from '@/lib/ticket-stats';

const n = (v: number) => v.toLocaleString('en-US');
const usd = (v: number) => `$${v.toFixed(v < 1 ? 3 : 2)}`;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-4">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-2 font-mono text-2xl font-medium tracking-tight">{value}</dd>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Where a bar sits relative to the biggest one in its list. */
function Share({ value, max }: { value: number; max: number }) {
  return (
    <span aria-hidden className="mt-1 block h-1.5 w-full overflow-hidden rounded bg-border">
      <span className="block h-full rounded bg-accent" style={{ width: `${max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0}%` }} />
    </span>
  );
}

/** What this ticket has cost and how it went: tokens, money, time, runs and subtasks. */
export function TicketOverview({ stats, pr }: { stats: TicketStats; pr?: { lines: number | null; soft: number; hard: number } }) {
  const { tokens, runs, subtasks } = stats;
  const maxStage = Math.max(0, ...stats.byStage.map((s) => s.tokens));
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Tokens used" value={n(tokens.counted)} hint="Input, output and cache writes: what counts against the usage window" />
        <Tile label="Cost" value={usd(stats.costUsd)} hint="As reported by Claude Code" />
        <Tile label="Claude running for" value={spell(stats.agentSeconds)} hint={`${spell(stats.elapsedSeconds)} since the ticket was created`} />
        <Tile label="Turns" value={n(stats.turns)} hint={`${runs.total} run${runs.total === 1 ? '' : 's'}`} />
        <Tile label="Input tokens" value={n(tokens.input)} />
        <Tile label="Output tokens" value={n(tokens.output)} />
        <Tile label="Cache writes" value={n(tokens.cacheWrite)} hint={`${n(tokens.cacheRead)} read from the cache (not counted)`} />
        {pr && (
          <Tile
            label="PR size"
            value={pr.lines === null ? '—' : `${n(pr.lines)} lines`}
            hint={pr.lines === null ? `Measured after each subtask. Limits: ${n(pr.soft)} soft, ${n(pr.hard)} hard.` : pr.lines > pr.hard ? `Over the hard limit of ${n(pr.hard)}: review it commit by commit` : pr.lines > pr.soft ? `Over the soft limit of ${n(pr.soft)} (hard ${n(pr.hard)})` : `Within the soft limit of ${n(pr.soft)}`}
          />
        )}
        <Tile label="Subtasks" value={`${subtasks.done} / ${subtasks.total}`} hint={`${subtasks.fixRounds} fix round${subtasks.fixRounds === 1 ? '' : 's'} in total`} />
      </dl>

      <section aria-label="Runs" className="panel p-4">
        <h2 className="text-sm font-medium">Runs</h2>
        <p className="mt-2 text-sm text-muted">
          {runs.succeeded} succeeded · {runs.failed} failed · {runs.superseded} replaced by a rerun · {runs.byUser} started by you
        </p>
      </section>

      <section aria-label="Tokens by stage" className="panel p-4">
        <h2 className="text-sm font-medium">By stage</h2>
        {stats.byStage.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No stage has run for this ticket yet.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-normal">Stage</th>
                <th className="w-1/3 py-1 font-normal">Tokens</th>
                <th className="py-1 text-right font-normal">Runs</th>
                <th className="py-1 text-right font-normal">Time</th>
                <th className="py-1 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {stats.byStage.map((s) => (
                <tr key={s.stage} className="border-t border-border">
                  <td className="py-2 font-mono text-xs">{s.stage}</td>
                  <td className="py-2 pr-4">
                    <span className="font-mono text-xs">{n(s.tokens)}</span>
                    <Share value={s.tokens} max={maxStage} />
                  </td>
                  <td className="py-2 text-right">{s.runs}</td>
                  <td className="py-2 text-right">{spell(s.seconds)}</td>
                  <td className="py-2 text-right">{usd(s.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {stats.byModel.length > 0 && (
        <section aria-label="Tokens by model" className="panel p-4">
          <h2 className="text-sm font-medium">By model</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {stats.byModel.map((m) => (
              <li key={m.model} className="flex justify-between gap-3">
                <span className="font-mono text-xs">{m.model}</span>
                <span className="text-muted">
                  {n(m.tokens)} tokens · {m.runs} run{m.runs === 1 ? '' : 's'} · {usd(m.costUsd)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
