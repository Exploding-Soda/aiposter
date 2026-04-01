import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
const USERNAME = __ENV.USERNAME || "";
const PASSWORD = __ENV.PASSWORD || "";
const LOGIN_PER_VU = String(__ENV.LOGIN_PER_VU || "0") === "1";
const REGISTER_IF_MISSING = String(__ENV.REGISTER_IF_MISSING || "0") === "1";

const TASK_TIMEOUT_MS = Number(__ENV.TASK_TIMEOUT_MS || 120000);
const POLL_INTERVAL_MS = Number(__ENV.POLL_INTERVAL_MS || 1000);
const THINK_TIME_MS = Number(__ENV.THINK_TIME_MS || 0);
const SCENARIO_MODE = (__ENV.SCENARIO_MODE || "arrival-rate").trim().toLowerCase();

const RATE = Number(__ENV.RATE || 2);
const DURATION = __ENV.DURATION || "1m";
const PRE_ALLOCATED_VUS = Number(__ENV.PRE_ALLOCATED_VUS || 20);
const MAX_VUS = Number(__ENV.MAX_VUS || 100);
const VUS = Number(__ENV.VUS || PRE_ALLOCATED_VUS);
const SUBMIT_P95_THRESHOLD_MS = Number(__ENV.SUBMIT_P95_THRESHOLD_MS || 2000);

const IMAGE_MODE = String(__ENV.IMAGE_MODE || "0") === "1";
const IMAGE_COUNT = Number(__ENV.IMAGE_COUNT || 0);
const MODEL = __ENV.MODEL || (IMAGE_MODE ? "google/gemini-3.1-flash-image-preview" : "mock-loadtest-model");
const PROMPT = __ENV.PROMPT || "Generate a poster concept for Wilton workshop load test.";

const submitDuration = new Trend("ai_task_submit_duration", true);
const completionDuration = new Trend("ai_task_completion_duration", true);
const pollRequests = new Counter("ai_task_poll_requests");
const completedTasks = new Counter("ai_task_completed");
const failedTasks = new Counter("ai_task_failed");
const timeoutTasks = new Counter("ai_task_timeout");
const endToEndSuccess = new Rate("ai_task_e2e_success");

const scenario =
  SCENARIO_MODE === "constant-vus"
    ? {
        executor: "constant-vus",
        vus: VUS,
        duration: DURATION,
      }
    : {
        executor: "constant-arrival-rate",
        rate: RATE,
        timeUnit: "1s",
        duration: DURATION,
        preAllocatedVUs: PRE_ALLOCATED_VUS,
        maxVUs: MAX_VUS,
      };

export const options = {
  scenarios: {
    ai_tasks: scenario,
  },
  thresholds: Object.fromEntries(
    [
      ["http_req_failed", ["rate<0.05"]],
      ["ai_task_e2e_success", ["rate>0.9"]],
      SUBMIT_P95_THRESHOLD_MS > 0
        ? ["ai_task_submit_duration", [`p(95)<${SUBMIT_P95_THRESHOLD_MS}`]]
        : null,
    ].filter(Boolean),
  ),
};

function jsonHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function buildPayload() {
  const content = [{ type: "text", text: PROMPT }];
  for (let i = 0; i < IMAGE_COUNT; i += 1) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${tinyPngBase64}`,
      },
    });
  }
  return {
    model: MODEL,
    stream: false,
    messages: [
      {
        role: "user",
        content: IMAGE_MODE ? content : PROMPT,
      },
    ],
  };
}

function register(username, password) {
  const response = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ username, password }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (response.status !== 200 && response.status !== 409) {
    fail(`register failed: status=${response.status} body=${response.body}`);
  }
}

function login(username, password) {
  const response = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ username, password }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (response.status === 401 && REGISTER_IF_MISSING) {
    register(username, password);
    return login(username, password);
  }

  const ok = check(response, {
    "login ok": (r) => r.status === 200,
    "login has access token": (r) => {
      try {
        return Boolean(r.json("accessToken"));
      } catch (_) {
        return false;
      }
    },
  });
  if (!ok) {
    fail(`login failed: status=${response.status} body=${response.body}`);
  }
  return response.json("accessToken");
}

export function setup() {
  if (!USERNAME || !PASSWORD) {
    fail("Please provide USERNAME and PASSWORD.");
  }
  if (LOGIN_PER_VU) {
    return {};
  }
  return { accessToken: login(USERNAME, PASSWORD) };
}

function resolveAccessToken(data) {
  if (LOGIN_PER_VU) {
    return login(USERNAME, PASSWORD);
  }
  if (!data || !data.accessToken) {
    fail("setup access token is missing");
  }
  return data.accessToken;
}

export default function (data) {
  const accessToken = resolveAccessToken(data);
  const payload = buildPayload();
  const submitStartedAt = Date.now();
  const submitResponse = http.post(
    `${BASE_URL}/ai/task/submit`,
    JSON.stringify({
      taskType: "chat",
      payload,
    }),
    { headers: jsonHeaders(accessToken) },
  );
  submitDuration.add(Date.now() - submitStartedAt);

  const submitOk = check(submitResponse, {
    "submit ok": (r) => r.status === 200,
    "submit has task id": (r) => {
      try {
        return Boolean(r.json("taskId"));
      } catch (_) {
        return false;
      }
    },
  });

  if (!submitOk) {
    failedTasks.add(1);
    endToEndSuccess.add(false);
    fail(`submit failed: status=${submitResponse.status} body=${submitResponse.body}`);
  }

  const taskId = submitResponse.json("taskId");
  const taskStartedAt = Date.now();
  let status = "pending";

  while (Date.now() - taskStartedAt <= TASK_TIMEOUT_MS) {
    pollRequests.add(1);
    const statusResponse = http.get(
      `${BASE_URL}/ai/task/${taskId}/status`,
      { headers: jsonHeaders(accessToken) },
    );

    const statusOk = check(statusResponse, {
      "status ok": (r) => r.status === 200,
    });
    if (!statusOk) {
      failedTasks.add(1);
      endToEndSuccess.add(false);
      fail(`status failed: status=${statusResponse.status} body=${statusResponse.body}`);
    }

    status = statusResponse.json("status");
    if (status === "completed") {
      completionDuration.add(Date.now() - taskStartedAt);
      completedTasks.add(1);
      endToEndSuccess.add(true);
      if (THINK_TIME_MS > 0) {
        sleep(THINK_TIME_MS / 1000);
      }
      return;
    }

    if (status === "error") {
      completionDuration.add(Date.now() - taskStartedAt);
      failedTasks.add(1);
      endToEndSuccess.add(false);
      return;
    }

    sleep(POLL_INTERVAL_MS / 1000);
  }

  timeoutTasks.add(1);
  endToEndSuccess.add(false);
}

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn9WJ8AAAAASUVORK5CYII=";
