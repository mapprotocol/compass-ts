import { error } from "console";

// global var
let prefix: string = "";
let hooksUrl: string = "";
const alarmMap: Map<string, number> = new Map();

// init
export function initAlarm(env: string, hooks: string): void {
  prefix = env;
  hooksUrl = hooks;
  console.log("env ", env, " hooks", hooks)
}

// alarm function
export async function alarm(msg: string, ctx?: AbortSignal): Promise<void> {
  if (!hooksUrl) {
    console.info("hooks is empty");
    return;
  }

  console.log("send alarm in");

  const now = Math.floor(Date.now() / 1000); // 当前时间戳（秒）
  const lastSent = alarmMap.get(msg);

  // 5分钟内相同的告警忽略
  if (lastSent && now - lastSent < 300) {
    return;
  }
  alarmMap.set(msg, now);

  try {
    const body = JSON.stringify({
      text: `${prefix} ${msg}`
    });

    // request
    const response = await fetch(hooksUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: body,
      signal: ctx // support cancel request
    });

    if (!response.ok) {
      const data = await response.text();
      console.warn(`Request failed with status ${response.status}: ${data}`);
      return;
    }

    const data = await response.text();
    console.log("send alarm message", "resp", data);
  } catch (error) {
    console.warn('Alarm request failed', error);
  }
}