'use client';

// app/bulletin/[id]/_DeleteButton.tsx
// Client component – potvrzení + API call pro soft delete

import { useState }  from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  postId: string;
}

export default function DeleteButton({ postId }: Props) {
  const router   = useRouter();
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm('Opravdu chcete příspěvek smazat? Bude skryt z nástěnky.')) return;

    setPending(true);
    setError(null);

    try {
      const res = await fetch(`/api/bulletin/posts/${postId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      router.push('/dashboard/bulletin');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smazání selhalo');
      setPending(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleDelete}
        disabled={pending}
        className="text-sm text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors"
      >
        {pending ? 'Mažu…' : '🗑 Smazat příspěvek'}
      </button>
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
