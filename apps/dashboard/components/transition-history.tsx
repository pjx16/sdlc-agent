import { LocalTime } from '@/components/local-time';
import { StateBadge } from './state-badge';

import type { TransitionView } from '@/lib/types';

/** Every state change of a ticket, oldest first. */
export function TransitionHistory({ transitions }: { transitions: TransitionView[] }) {
  if (transitions.length === 0) return <p className="text-sm text-muted">No state changes yet.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-muted">
        <tr>
          <th className="py-2 font-normal">When</th>
          <th className="py-2 font-normal">Change</th>
          <th className="py-2 font-normal">By</th>
          <th className="py-2 font-normal">Reason</th>
        </tr>
      </thead>
      <tbody>
        {transitions.map((t) => (
          <tr key={t.id} className="border-t border-border align-top">
            <td className="py-3 whitespace-nowrap text-muted"><LocalTime iso={t.at} /></td>
            <td className="py-3">
              <span className="flex flex-wrap items-center gap-2">
                <StateBadge status={t.fromStatus} />
                <span aria-label="to">→</span>
                <StateBadge status={t.toStatus} />
              </span>
            </td>
            <td className="py-3 text-muted">{t.actor}</td>
            <td className="py-3">{t.reason ?? <span className="text-muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
