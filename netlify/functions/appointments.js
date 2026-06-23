const { Pool } = require("pg");

let pool;

const petTypes = new Set(["狗狗", "猫咪", "其他小宠"]);
const serviceTypes = new Set(["基础洗护", "猫咪专护", "造型修剪", "SPA护理"]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  };
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  return pool;
}

function validateAppointment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "提交的数据格式不正确";
  }

  const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const petType = input.petType;
  const serviceType = input.serviceType;
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const appointmentAt = new Date(input.appointmentAt);

  if (!customerName || customerName.length > 50) return "请输入 1 到 50 个字的姓名";
  if (!/^1[3-9]\d{9}$/.test(phone)) return "请输入正确的 11 位手机号";
  if (!petTypes.has(petType)) return "请选择有效的宠物类型";
  if (!serviceTypes.has(serviceType)) return "请选择有效的预约服务";
  if (Number.isNaN(appointmentAt.getTime())) return "请选择有效的到店时间";
  if (appointmentAt.getTime() < Date.now() - 60_000) return "到店时间不能早于现在";
  if (notes.length > 500) return "备注不能超过 500 个字";

  return { customerName, phone, petType, serviceType, appointmentAt, notes };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      ...json(405, { message: "只支持提交预约" }),
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Allow: "POST",
      },
    };
  }

  let input;

  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { message: "提交的数据格式不正确" });
  }

  const appointment = validateAppointment(input);

  if (typeof appointment === "string") {
    return json(400, { message: appointment });
  }

  const database = getPool();

  if (!database) {
    return json(201, {
      id: `demo-${Date.now()}`,
      appointmentAt: appointment.appointmentAt.toISOString(),
      message: "预约已记录（演示模式，不会保存到数据库）",
      demo: true,
    });
  }

  try {
    const result = await database.query(
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

    return json(201, {
      id: result.rows[0].id,
      appointmentAt: result.rows[0].appointment_at,
      message: "预约提交成功",
    });
  } catch (error) {
    console.error("Failed to create appointment:", error);
    return json(500, { message: "预约暂时无法提交，请稍后重试" });
  }
};
