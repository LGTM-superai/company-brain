const GMT8_TIME_ZONE = "Asia/Singapore";

export function gmt8TodayFromNow(nowMs = Date.now()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: GMT8_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date(nowMs));
}

export function overdueInfo(dueDate?: string | null, nowMs = Date.now()) {
  if (!dueDate) {
    return {
      isOverdue: false,
      daysOverdue: 0,
      todayLocal: gmt8TodayFromNow(nowMs),
    };
  }

  const todayLocal = gmt8TodayFromNow(nowMs);
  const todayMs = Date.parse(`${todayLocal}T00:00:00.000Z`);
  const dueMs = Date.parse(`${dueDate}T00:00:00.000Z`);
  const daysOverdue = Math.floor((todayMs - dueMs) / 86_400_000);

  return {
    isOverdue: daysOverdue > 0,
    daysOverdue: Math.max(0, daysOverdue),
    todayLocal,
  };
}
