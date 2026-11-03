import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DayUptimeGraph, {
  DayReading,
  MAX_BARS_PER_STRIP,
  UptimeBarDaySummary,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green, Red } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";

/*
 * Event Logic: a window longer than MAX_BARS_PER_STRIP days is drawn with
 * several days per bar (three for a year), so a 365-day strip stays readable.
 * A window up to that many days keeps one bar per day, exactly as upstream.
 */

const END_DATE: Date = OneUptimeDate.getCurrentDate();

const DAY_SECONDS: number = 24 * 60 * 60;

type OnBarClickFunction = (
  date: Date,
  incidents: Array<UptimeBarTooltipIncident>,
  summary: UptimeBarDaySummary,
) => void;

function startDateForDays(days: number): Date {
  // getDays counts both ends, so "days ago" is one less than the window.
  return OneUptimeDate.getSomeDaysAgoFromDate(END_DATE, days - 1);
}

function dayStart(startDate: Date, dayIndex: number): Date {
  return OneUptimeDate.getStartOfDay(
    OneUptimeDate.getSomeDaysAfterDate(startDate, dayIndex),
  );
}

function dayLabel(date: Date): string {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date, true);
}

function makeReading(data: {
  startDate: Date;
  dayIndex: number;
  downSeconds: number;
}): DayReading {
  const statusDurations: Array<StatusDuration> = [
    {
      label: "Operational",
      seconds: DAY_SECONDS - data.downSeconds,
      color: Green,
      isDowntime: false,
      priority: 1,
    },
  ];

  if (data.downSeconds > 0) {
    statusDurations.push({
      label: "Offline",
      seconds: data.downSeconds,
      color: Red,
      isDowntime: true,
      priority: 3,
    });
  }

  return {
    dayStart: dayStart(data.startDate, data.dayIndex),
    daySeconds: DAY_SECONDS,
    coveredSeconds: DAY_SECONDS,
    statusDurations: statusDurations,
  };
}

function renderGraph(data: {
  days: number;
  dayReadings?: Array<DayReading> | undefined;
}): { startDate: Date; onBarClick: ReturnType<typeof jest.fn<OnBarClickFunction>> } {
  const startDate: Date = startDateForDays(data.days);
  const onBarClick: ReturnType<typeof jest.fn<OnBarClickFunction>> =
    jest.fn<OnBarClickFunction>();

  render(
    <DayUptimeGraph
      startDate={startDate}
      endDate={END_DATE}
      events={[]}
      dayReadings={data.dayReadings}
      defaultBarColor={Green}
      height={10}
      onBarClick={onBarClick}
    />,
  );

  return { startDate: startDate, onBarClick: onBarClick };
}

function getBars(): Array<HTMLElement> {
  return screen.getAllByTestId("uptime-bar");
}

afterEach(() => {
  cleanup();
});

describe("DayUptimeGraph - long windows share bars between days", () => {
  test("a window of MAX_BARS_PER_STRIP days keeps one bar per day", () => {
    renderGraph({ days: MAX_BARS_PER_STRIP });

    const bars: Array<HTMLElement> = getBars();

    expect(bars).toHaveLength(MAX_BARS_PER_STRIP);

    for (const bar of bars) {
      expect(bar.getAttribute("aria-label")).not.toContain(" – ");
    }
  });

  test("a year is 122 bars of three days, the last one shorter", () => {
    const { startDate } = renderGraph({ days: 365 });

    const bars: Array<HTMLElement> = getBars();

    // ceil(365 / 3): 121 bars of three days and one of two.
    expect(bars).toHaveLength(122);

    expect(bars[0]!.getAttribute("aria-label")).toContain(
      `${dayLabel(startDate)} – ${dayLabel(
        OneUptimeDate.getSomeDaysAfterDate(startDate, 2),
      )}`,
    );

    expect(bars[121]!.getAttribute("aria-label")).toContain(
      `${dayLabel(OneUptimeDate.getSomeDaysAfterDate(startDate, 363))} – ${dayLabel(
        OneUptimeDate.getSomeDaysAfterDate(startDate, 364),
      )}`,
    );

    expect(bars[0]).toHaveAttribute("data-day-index", "0");
    expect(bars[121]).toHaveAttribute("data-day-index", "121");
  });

  test("a bar's reading is the sum of its days, and its span is reported", () => {
    const startDate: Date = startDateForDays(365);

    const { onBarClick } = renderGraph({
      days: 365,
      dayReadings: [
        makeReading({ startDate: startDate, dayIndex: 0, downSeconds: 0 }),
        makeReading({ startDate: startDate, dayIndex: 1, downSeconds: 3600 }),
        makeReading({ startDate: startDate, dayIndex: 2, downSeconds: 0 }),
      ],
    });

    const bars: Array<HTMLElement> = getBars();

    fireEvent.click(bars[0]!);

    expect(onBarClick).toHaveBeenCalledTimes(1);

    const summary: UptimeBarDaySummary = onBarClick.mock.calls[0]![2];

    // One hour down out of three full days.
    expect(summary.uptimePercent).toBeCloseTo(
      ((3 * DAY_SECONDS - 3600) / (3 * DAY_SECONDS)) * 100,
      4,
    );
    expect(summary.hasEvents).toBe(true);

    expect(
      OneUptimeDate.getStartOfDay(summary.date).getTime(),
    ).toBe(dayStart(startDate, 0).getTime());
    expect(summary.endDate).toBeDefined();
    expect(
      OneUptimeDate.getStartOfDay(summary.endDate as Date).getTime(),
    ).toBe(dayStart(startDate, 2).getTime());

    const offline: StatusDuration | undefined = summary.statusDurations.find(
      (duration: StatusDuration) => {
        return duration.label === "Offline";
      },
    );
    const operational: StatusDuration | undefined =
      summary.statusDurations.find((duration: StatusDuration) => {
        return duration.label === "Operational";
      });

    expect(offline?.seconds).toBe(3600);
    expect(offline?.isDowntime).toBe(true);
    expect(operational?.seconds).toBe(3 * DAY_SECONDS - 3600);

    // The hour down paints the whole three-day bar in the downtime colour.
    expect(bars[0]!.getAttribute("aria-label")).toContain("% uptime");

    // Days nobody measured stay a no-data bar, even next to measured ones.
    expect(bars[1]!.getAttribute("aria-label")).toContain(": no data");
  });

  test("a one-day bar keeps its single-day label and no span", () => {
    const startDate: Date = startDateForDays(10);

    const { onBarClick } = renderGraph({
      days: 10,
      dayReadings: [
        makeReading({ startDate: startDate, dayIndex: 0, downSeconds: 0 }),
      ],
    });

    const bars: Array<HTMLElement> = getBars();

    expect(bars).toHaveLength(10);
    expect(bars[0]!.getAttribute("aria-label")).toContain(
      `${dayLabel(startDate)}: 100% uptime`,
    );

    fireEvent.click(bars[0]!);

    const summary: UptimeBarDaySummary = onBarClick.mock.calls[0]![2];

    expect(summary.endDate).toBeUndefined();
  });
});
