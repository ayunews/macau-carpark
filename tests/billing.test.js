import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateParkingCost,
  formatDuration,
  formatMoney,
  getParkingAmount,
  summarizeTariff,
} from "../billing.js";

const basePark = {
  feeHeading: "每半小時或不足半小時之收費 (MOP$)",
  tariffs: {
    light: "(日間)每半小時MOP$3\n(夜間)每半小時MOP$1.5",
    heavy: "-",
    motorcycle:
      "(日間)每半小時MOP$1\n(夜間)每半小時MOP$0.5\n日間封頂MOP$12\n夜間封頂MOP$6",
    notes: "日間：上午八時至下午八時前\n夜間：下午八時至翌日上午八時前",
  },
  live: {
    light: { available: 10, total: 100 },
    motorcycle: { available: 20, total: 50 },
  },
};

test("calculates a daytime half-hour rate", () => {
  const result = calculateParkingCost({
    park: basePark,
    vehicleKey: "light",
    entry: new Date("2026-09-29T10:00:00"),
    exit: new Date("2026-09-29T11:00:00"),
  });

  assert.equal(result.supported, true);
  assert.equal(result.amount, 6);
  assert.equal(result.breakdown.length, 1);
});

test("splits a stay across day and night", () => {
  const result = calculateParkingCost({
    park: basePark,
    vehicleKey: "light",
    entry: new Date("2026-09-29T19:45:00"),
    exit: new Date("2026-09-29T20:15:00"),
  });

  assert.equal(result.amount, 4.5);
  assert.equal(result.breakdown.length, 2);
});

test("applies the motorcycle daytime cap", () => {
  const result = calculateParkingCost({
    park: basePark,
    vehicleKey: "motorcycle",
    entry: new Date("2026-09-29T08:00:00"),
    exit: new Date("2026-09-29T16:00:00"),
  });

  assert.equal(result.amount, 12);
  assert.equal(result.breakdown[0].capped, true);
});

test("parses first-hour then half-hour pricing", () => {
  const park = {
    ...basePark,
    feeHeading: "每小時或不足一小時之收費(MOP$)",
    tariffs: {
      ...basePark.tariffs,
      light: "(日間)首小時MOP$3，隨後每半小時MOP$5。\n(夜間)MOP$4",
    },
  };
  const result = calculateParkingCost({
    park,
    vehicleKey: "light",
    entry: new Date("2026-09-29T09:00:00"),
    exit: new Date("2026-09-29T10:30:00"),
  });

  assert.equal(result.amount, 8);
  assert.equal(result.breakdown[0].minutes, 90);
});

test("parses a night rate written after the period label", () => {
  const park = {
    ...basePark,
    feeHeading: "每小時或不足一小時之收費(MOP$)",
    tariffs: {
      ...basePark.tariffs,
      light: "(日間)首小時MOP$3，隨後每半小時MOP$5。\n(夜間)MOP$4",
    },
  };
  const result = calculateParkingCost({
    park,
    vehicleKey: "light",
    entry: new Date("2026-09-29T23:25:00"),
    exit: new Date("2026-09-30T00:25:00"),
  });

  assert.equal(result.supported, true);
  assert.equal(result.amount, 4);
});

test("supports marked heavy-vehicle variants", () => {
  const park = {
    ...basePark,
    feeHeading: "每小時或不足一小時之收費(MOP$)",
    tariffs: {
      ...basePark.tariffs,
      heavy: "MOP $4(註1) MOP $5(註2)",
      notes: "註1：長度8米或以下之重型汽車。註2：長度8米以上之重型汽車。",
    },
  };
  const parsed = summarizeTariff(park, "heavy");
  assert.equal(parsed, "2 種車長收費方案");

  const result = calculateParkingCost({
    park,
    vehicleKey: "heavy",
    entry: new Date("2026-09-29T10:00:00"),
    exit: new Date("2026-09-29T11:00:00"),
    optionId: "note-2",
  });
  assert.equal(result.amount, 5);
});

test("honours fifteen-minute grace", () => {
  const park = {
    ...basePark,
    tariffs: {
      ...basePark.tariffs,
      notes: `${basePark.tariffs.notes}\n進入停車場並於十五分鐘內離場，免收相關泊車費用。`,
    },
  };
  const result = calculateParkingCost({
    park,
    vehicleKey: "light",
    entry: new Date("2026-09-29T10:00:00"),
    exit: new Date("2026-09-29T10:15:00"),
  });

  assert.equal(result.amount, 0);
});

test("formats values consistently", () => {
  assert.equal(formatMoney(6), "MOP $6");
  assert.equal(formatMoney(1.5), "MOP $1.5");
  assert.equal(formatDuration(90), "1 小時 30 分鐘");
});

test("passes maintenance state through parking availability", () => {
  const availability = getParkingAmount(
    {
      maintenance: true,
      live: {
        light: { available: null, total: 100, maintenance: true },
      },
    },
    "light",
  );

  assert.equal(availability.maintenance, true);
  assert.equal(availability.available, null);
});
