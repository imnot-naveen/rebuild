import { useEffect, useState } from 'react';
import { coordinatorRequest } from './coordinator-api';
import type { CoordinatorAccess, StockPage } from './coordinator-api';

export function useStockLots({ eventId, getToken }: CoordinatorAccess, category = '', revision = 0) {
  const [data, setData] = useState<StockPage>({ stockLots: [], nextCursor: null });
  const [page, setPage] = useState({ cursor: '', revision });
  const [loadedPage, setLoadedPage] = useState<{ page: typeof page; revision: number; error: string }>();
  const cursor = revision === page.revision ? page.cursor : '';
  const loading = loadedPage?.page !== page || loadedPage?.revision !== revision;
  const error = loading ? '' : loadedPage.error;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (cursor) params.set('cursor', cursor);
    const query = params.size ? `?${params}` : '';
    void coordinatorRequest<StockPage>({ eventId, getToken }, `/stock-lots${query}`, signal)
      .then((result) => {
        if (signal.aborted) return;
        setData((previous) => ({
          stockLots: cursor ? [...previous.stockLots, ...result.stockLots] : result.stockLots,
          nextCursor: result.nextCursor,
        }));
        setLoadedPage({ page, revision, error: '' });
      })
      .catch((reason: Error) => {
        if (signal.aborted) return;
        setLoadedPage({ page, revision, error: reason.message });
      });
    return () => controller.abort();
  }, [eventId, getToken, category, cursor, page, revision]);

  function load(cursor: string) {
    setPage({ cursor, revision });
  }

  return {
    ...data, loading, error,
    refresh: () => load(''),
    retry: () => load(cursor),
    loadMore: () => { if (data.nextCursor) load(data.nextCursor); },
  };
}
