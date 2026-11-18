import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { readBossJobList } from "../../src/infrastructure/boss-executor/boss-job-list.js";

for (const [path, state] of [
  ["/web/passport/zp/security.html", "verification"],
  ["/web/user/", "login"],
]) {
  test(`BOSS ${path} 加载时也会识别为 ${state}`, () => {
    const result = runInNewContext(`(${readBossJobList.toString()})()`, {
      URL,
      location: new URL(path, "https://www.zhipin.com"),
      document: { readyState: "loading", querySelectorAll: () => [] },
      __name: (value: unknown) => value,
    });
    assert.equal(result.state, state);
    assert.equal(result.jobs.length, 0);
  });
}
