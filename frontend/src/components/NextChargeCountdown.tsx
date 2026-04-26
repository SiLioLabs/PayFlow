import React, { useEffect, useState } from "react";

interface Props {
    nextChargeTimestamp: number; // Unix seconds
}

interface Countdown {
    days: number;
    hours: number;
    minutes: number;
    overdue: boolean;
}

function computeCountdown(nextChargeTimestamp: number): Countdown {
    const nowMs = Date.now();
    const targetMs = nextChargeTimestamp * 1000;
    const diffMs = targetMs - nowMs;

    if (diffMs <= 0) {
        return { days: 0, hours: 0, minutes: 0, overdue: true };
    }

    const totalMinutes = Math.floor(diffMs / 60_000);
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);
    const hours = totalHours % 24;
    const days = Math.floor(totalHours / 24);

    return { days, hours, minutes, overdue: false };
}

export default function NextChargeCountdown({ nextChargeTimestamp }: Props) {
    const [countdown, setCountdown] = useState<Countdown>(() =>
        computeCountdown(nextChargeTimestamp)
    );

    useEffect(() => {
        // Recompute immediately when the prop changes
        setCountdown(computeCountdown(nextChargeTimestamp));

        const id = setInterval(() => {
            setCountdown(computeCountdown(nextChargeTimestamp));
        }, 60_000);

        return () => clearInterval(id);
    }, [nextChargeTimestamp]);

    if (countdown.overdue) {
        return <span className="badge badge-warning">Overdue</span>;
    }

    const { days, hours, minutes } = countdown;
    return (
        <span className="text-mono">
            {days}d {hours}h {minutes}m
        </span>
    );
}
