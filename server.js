const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const host = "127.0.0.1";
const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;

if (pool) {
  pool.on("error", (error) => {
    console.error("Unexpected database pool error:", error.message);
  });
}

const petTypes = new Set(["狗狗", "猫咪", "其他小宠"]);
const serviceTypes = new Set(["基础洗护", "猫咪专护", "造型修剪", "SPA护理"]);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bodyTooLarge = false;

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (bodyTooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 16_384) {
        bodyTooLarge = true;
      }
    });
    request.on("end", () => {
      if (bodyTooLarge) {
        reject(new Error("BODY_TOO_LARGE"));
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    request.on("error", reject);
  });
}

function validateAppointment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "提交的数据格式不正确";

  const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const petType = input.petType;
  const serviceType = input.serviceType;
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const appointmentAt = new Date(input.appointmentAt);

  if (!customerName || customerName.length > 50) return "请输入 1 至 50 个字的姓名";
  if (!/^1[3-9]\d{9}$/.test(phone)) return "请输入正确的 11 位手机号";
  if (!petTypes.has(petType)) return "请选择有效的宠物类型";
  if (!serviceTypes.has(serviceType)) return "请选择有效的预约服务";
  if (Number.isNaN(appointmentAt.getTime())) return "请选择有效的到店时间";
  if (notes.length > 500) return "备注不能超过 500 个字";

  return { customerName, phone, petType, serviceType, appointmentAt, notes };
}

async function createAppointment(request, response) {
  if (!pool) {
    sendJson(response, 503, { message: "预约服务尚未配置数据库连接" });
    return;
  }

  try {
    const input = await readJsonBody(request);
    const appointment = validateAppointment(input);

    if (typeof appointment === "string") {
      sendJson(response, 400, { message: appointment });
      return;
    }

    const result = await pool.query(
      `insert into public.appointments
        (customer_name, phone, pet_type, service_type, appointment_at, notes)
       values ($1, $2, $3, $4, $5, $6)
       returning id, appointment_at`,
      [
        appointment.customerName,
        appointment.phone,
        appointment.petType,
        appointment.serviceType,
        appointment.appointmentAt,
        appointment.notes,
      ],
    );

    sendJson(response, 201, {
      id: result.rows[0].id,
      appointmentAt: result.rows[0].appointment_at,
      message: "预约提交成功",
    });
  } catch (error) {
    if (error.message === "INVALID_JSON" || error.message === "BODY_TOO_LARGE") {
      sendJson(response, 400, { message: "提交的数据格式不正确" });
      return;
    }

    console.error("Failed to create appointment:", error);
    if (error.code === "28P01") {
      sendJson(response, 500, { message: "数据库连接认证失败，请检查 DATABASE_URL 的用户名和密码" });
      return;
    }

    sendJson(response, 500, { message: "预约暂时无法提交，请稍后重试" });
  }
}

const server = http.createServer((request, response) => {
  let pathname;

  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
  } catch {
    response.writeHead(400).end("Bad Request");
    return;
  }

  if (pathname === "/api/appointments") {
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end("Method Not Allowed");
      return;
    }

    createAppointment(request, response);
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(root, relativePath);

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404).end("Not Found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, host, () => {
  console.log(`Pet store is running at http://${host}:${port}`);
  if (!pool) {
    console.warn("DATABASE_URL is not set; appointment submissions are disabled.");
  }
});
