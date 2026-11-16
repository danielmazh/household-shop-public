import { useEffect, useState } from 'preact/hooks';
import { t } from './i18n';
import { dayNames } from './labels';

/** Local midnight of today, so it changes only when the day changes. */
export const dayKey = () => new Date().setHours(0, 0, 0, 0);

/** Today as a key. The app can stay open past midnight: it updates when the app comes back. */
export function useToday(): number {
  const [day, setDay] = useState(dayKey);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setDay(dayKey());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return day;
}

const dayIn = (today: number, inDays: number) => dayNames()[(new Date(today).getDay() + inDays) % 7]!;

/** When a trip comes: "היום", "מחר" or "יום חמישי". */
export const whenLabel = (today: number, inDays: number) => t('when')(inDays, dayIn(today, inDays));

/** The same in a sentence: "היום", "מחר", "ביום חמישי". */
export const whenInSentence = (today: number, inDays: number) => t('whenInSentence')(inDays, dayIn(today, inDays));
