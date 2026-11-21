import type { UsageSummaryView } from '@/lib/types';

export function TokensTable({ rows }: { rows: UsageSummaryView['rows'] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No stage has run in the last 30 days.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-muted">
        <tr>
          <th className="py-2 font-normal">Stage</th>
          <th className="py-2 font-normal">Model</th>
          <th className="py-2 text-right font-normal">Runs</th>
          <th className="py-2 text-right font-normal">Tokens</th>
          <th className="py-2 text-right font-normal">Credits</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={`${t.stage}/${t.model}`} className="border-t border-border">
            <td className="py-2">{t.stage}</td>
            <td className="py-2 text-muted">{t.model}</td>
            <td className="py-2 text-right">{t.runs}</td>
            <td className="py-2 text-right">{t.tokens.toLocaleString('en-US')}</td>
            <td className="py-2 text-right">{t.credits.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
