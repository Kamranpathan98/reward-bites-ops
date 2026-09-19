import * as React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/use-auth';

export function KitchenLayout(): JSX.Element {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [currentTime, setCurrentTime] = React.useState<string>('');

  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased select-none">
      {/* KDS Header Bar */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 z-10">
        {/* Left: Exit button and Restaurant title */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={() => navigate('/app/orders')}
            className="border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 hover:text-white min-h-[48px] min-w-[48px] px-3 font-semibold text-sm flex items-center gap-2"
            aria-label="Exit Kitchen Display"
          >
            <svg
              className="w-5 h-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span className="hidden sm:inline">Exit KDS</span>
          </Button>

          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              <span>{me?.tenant?.name ?? 'RewardBite'}</span>
              <span className="text-xs uppercase px-2 py-0.5 rounded bg-primary/20 text-primary-hover font-black tracking-wider border border-primary/30">
                KDS
              </span>
            </span>
            <span className="text-xs text-slate-400">Kitchen Display Station</span>
          </div>
        </div>

        {/* Right: Live Connection Indicator & Digital Clock */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden xs:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-700/40 text-emerald-400 text-xs font-semibold">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Live (3s)</span>
          </div>

          <div className="text-right font-tabular text-sm sm:text-base font-bold text-slate-200 tracking-wider bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700/60 shadow-inner">
            {currentTime || '--:--:--'}
          </div>
        </div>
      </header>

      {/* Main KDS Canvas */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
