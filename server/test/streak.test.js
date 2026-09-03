import { describe, it, expect } from "vitest";
import { createUser } from "./helpers.js";
import { recordLearningActivity, getStreakInfo, utcDateString } from "../src/utils/streak.js";

function daysAgoStr(n) {
  return utcDateString(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

describe("streak — calendar logic", () => {
  it("first learning activity sets the streak to 1", async () => {
    const user = await createUser({ username: "streak1" });
    await recordLearningActivity(user);
    expect(user.currentStreak).toBe(1);
    expect(user.longestStreak).toBe(1);
    expect(user.lastLearningDate).toBe(utcDateString());
  });

  it("learning on the immediately following calendar day increments the streak", async () => {
    const user = await createUser({ username: "streak2" });
    user.currentStreak = 3;
    user.longestStreak = 3;
    user.lastLearningDate = daysAgoStr(1);
    await user.save();

    await recordLearningActivity(user);
    expect(user.currentStreak).toBe(4);
    expect(user.lastLearningDate).toBe(utcDateString());
  });

  it("multiple activities on the same day increment the streak only once (not 4)", async () => {
    const user = await createUser({ username: "streak3" });
    await recordLearningActivity(user); // practice
    expect(user.currentStreak).toBe(1);
    await recordLearningActivity(user); // practice
    await recordLearningActivity(user); // mock
    await recordLearningActivity(user); // practice
    expect(user.currentStreak).toBe(1);
  });

  it("a missed day resets the streak to 1 on the next activity", async () => {
    const user = await createUser({ username: "streak4" });
    user.currentStreak = 5;
    user.longestStreak = 5;
    user.lastLearningDate = daysAgoStr(2); // gap of 2 days — Thursday missed, then Friday
    await user.save();

    await recordLearningActivity(user);
    expect(user.currentStreak).toBe(1);
  });

  it("longest streak is preserved through a reset, and updated once a new streak surpasses it", async () => {
    const user = await createUser({ username: "streak5" });
    user.currentStreak = 5;
    user.longestStreak = 10;
    user.lastLearningDate = daysAgoStr(3); // missed days — about to reset
    await user.save();
    await recordLearningActivity(user);
    expect(user.currentStreak).toBe(1);
    expect(user.longestStreak).toBe(10); // never overwritten by a smaller current streak

    user.currentStreak = 10;
    user.lastLearningDate = daysAgoStr(1);
    await user.save();
    await recordLearningActivity(user);
    expect(user.currentStreak).toBe(11);
    expect(user.longestStreak).toBe(11); // now genuinely surpassed
  });

  it("learnedToday is false before any activity today and true immediately after", async () => {
    const user = await createUser({ username: "streak6" });
    expect(getStreakInfo(user).learnedToday).toBe(false);
    await recordLearningActivity(user);
    expect(getStreakInfo(user).learnedToday).toBe(true);
  });
});
