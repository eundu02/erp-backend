import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';

// 마운트 시(및 deps 변경 시) fetcher를 호출해 데이터를 불러온다. reload()로 다시 불러올 수 있다.
export default function useApi(fetcher, deps = [], initial = undefined) {
  const { message } = App.useApp();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetcher());
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, reload, setData };
}
