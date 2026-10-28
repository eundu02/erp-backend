import { useMemo, useState } from 'react';
import { Flex, Segmented, Table, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { fmtNum } from '../utils';

// 일별 판매 수량 막대 차트 (단일 시리즈 → 범례 없음, 제목이 시리즈를 설명).
// 규격: 막대 ≤24px, 끝단 4px 라운드·기준선 쪽은 직각, 1px 실선 그리드, 막대별 hover 툴팁, 표 보기 제공.
const SERIES = '#2a78d6';
const GRID = '#e5e7eb';
const TEXT_MUTED = '#6b7280';
const HEIGHT = 200;

function niceMax(v) {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export default function DailySalesChart({ sales, days = 14 }) {
  const [view, setView] = useState('chart');

  const series = useMemo(() => {
    const byDate = {};
    sales.forEach((s) => { byDate[s.sale_date] = (byDate[s.sale_date] ?? 0) + s.total_qty; });
    return Array.from({ length: days }, (_, i) => {
      const d = dayjs().subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
      return { date: d, qty: byDate[d] ?? 0 };
    });
  }, [sales, days]);

  const max = niceMax(Math.max(...series.map((d) => d.qty)));
  const ticks = [max, max / 2, 0];
  const total = series.reduce((a, d) => a + d.qty, 0);

  return (
    <div>
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">
          최근 {days}일 합계 <Typography.Text strong>{fmtNum(total)}</Typography.Text>개 (확정 판매 기준)
        </Typography.Text>
        <Segmented size="small" value={view} onChange={setView} options={[{ label: '차트', value: 'chart' }, { label: '표로 보기', value: 'table' }]} />
      </Flex>

      {view === 'table' ? (
        <Table
          size="small"
          rowKey="date"
          pagination={false}
          scroll={{ y: 200 }}
          dataSource={[...series].reverse()}
          columns={[
            { title: '판매일', dataIndex: 'date' },
            { title: '판매 수량', dataIndex: 'qty', align: 'right', render: fmtNum },
          ]}
        />
      ) : (
        <Flex>
          {/* y축 눈금 */}
          <div style={{ position: 'relative', width: 36, height: HEIGHT, flexShrink: 0 }}>
            {ticks.map((t) => (
              <span
                key={t}
                style={{
                  position: 'absolute', right: 8, top: HEIGHT - (t / max) * HEIGHT - 8,
                  fontSize: 11, color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums',
                }}
              >
                {fmtNum(t)}
              </span>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ position: 'relative', height: HEIGHT }}>
              {ticks.map((t) => (
                <div key={t} style={{ position: 'absolute', left: 0, right: 0, top: HEIGHT - (t / max) * HEIGHT, borderTop: `1px solid ${GRID}` }} />
              ))}
              <Flex style={{ position: 'absolute', inset: 0 }}>
                {series.map((d) => (
                  <Tooltip
                    key={d.date}
                    title={<>{dayjs(d.date).format('M월 D일 (dd)')}<br /><b>{fmtNum(d.qty)}</b>개 판매</>}
                  >
                    {/* hit target = 막대보다 넓은 슬롯 전체 */}
                    <Flex justify="center" align="flex-end" style={{ flex: 1, height: '100%', cursor: 'default' }}>
                      <div
                        style={{
                          width: 'min(24px, 60%)',
                          height: `${(d.qty / max) * 100}%`,
                          background: SERIES,
                          borderRadius: '4px 4px 0 0',
                        }}
                      />
                    </Flex>
                  </Tooltip>
                ))}
              </Flex>
            </div>
            <Flex style={{ marginTop: 6 }}>
              {series.map((d, i) => (
                <span key={d.date} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>
                  {(days - 1 - i) % 3 === 0 ? dayjs(d.date).format('M/D') : ''}
                </span>
              ))}
            </Flex>
          </div>
        </Flex>
      )}
    </div>
  );
}
