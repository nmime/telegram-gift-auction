import { useState, useEffect, useMemo } from 'react';

interface CountdownResult {
  timeLeft: number;
  formatted: string;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  isUrgent: boolean;
}

export function useCountdown(endTime?: string): CountdownResult {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!endTime) {
      setTimeLeft(0);
      return;
    }

    const calculateTimeLeft = (): number => {
      const end = new Date(endTime).getTime();
      const now = Date.now();
      return Math.max(0, Math.floor((end - now) / 1000));
    };

    setTimeLeft(calculateTimeLeft());

    const interval = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [endTime]);

  const result = useMemo((): CountdownResult => {
    const hours = Math.floor(timeLeft / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    const seconds = timeLeft % 60;

    const formatted =
      hours > 0
        ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        : `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return {
      timeLeft,
      formatted,
      hours,
      minutes,
      seconds,
      isExpired: timeLeft <= 0,
      isUrgent: timeLeft > 0 && timeLeft <= 60,
    };
  }, [timeLeft]);

  return result;
}
