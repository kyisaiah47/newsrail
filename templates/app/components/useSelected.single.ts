'use client';
import { useCallback, useState } from 'react';
import type { Post } from '@/lib/feed';

/** The selected post, kept in component state (this app has one view). */
export function useSelected(posts: Post[]): [string, (id: string) => void] {
  const [id, setId] = useState<string>(posts[0]?.id ?? '');
  const select = useCallback((next: string) => setId(next), []);
  return [id, select];
}
