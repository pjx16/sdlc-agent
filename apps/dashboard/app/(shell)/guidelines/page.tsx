import { GuidelinesGallery } from '@/components/guidelines/gallery';
import { apiGet } from '@/lib/server-api';
import type { GuidelineEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function GuidelinesPage() {
  const catalogue = (await apiGet<GuidelineEntry[]>('/guidelines/catalogue')) ?? [];
  return (
    <section>
      <h1 className="text-2xl font-semibold">Guidelines</h1>
      <div className="mt-2">
        <GuidelinesGallery initial={catalogue} />
      </div>
    </section>
  );
}
