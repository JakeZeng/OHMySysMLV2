// Package templates 提供 3 个 M3 行业模板（汽车 / 航空 / 软件架构）。
//
// 设计目标（m3-launch-package §1.1 C1）：
//   - 每个模板 5-8 个 part def
//   - 可 instantiate：用户在 UI 点击 → 模板文本插入到 Monaco
//   - 内容贴近通用模式，不深入行业细节（避免领域专家 review 依赖）
//
// 来源：M3 W3 D13-14 实施（launch-package §2.2 Week 3）。
package templates

// Template 是行业模板的最小结构。
type Template struct {
	ID          string   `json:"id"`          // 唯一标识，如 "automotive-powertrain"
	Name        string   `json:"name"`        // 显示名（中文 + 英文）
	Industry    string   `json:"industry"`    // "automotive" / "aerospace" / "software"
	Description string   `json:"description"` // 1-2 句简介
	PartDefCount int     `json:"part_def_count"`
	Tags        []string `json:"tags"` // 用于前端过滤
	Content     string   `json:"content"` // SysML v2 文本
}

// All 返回全部 M3 模板。
// 顺序固定，方便前端按顺序展示。
func All() []Template {
	return []Template{
		AutomotivePowertrain,
		AerospaceFlightControl,
		SoftwareMicroservice,
	}
}

// ByIndustry 按行业过滤。
func ByIndustry(industry string) []Template {
	if industry == "" {
		return All()
	}
	out := []Template{}
	for _, t := range All() {
		if t.Industry == industry {
			out = append(out, t)
		}
	}
	return out
}

// ByID 按 ID 查找；找不到返回 nil。
func ByID(id string) *Template {
	for i := range All() {
		if All()[i].ID == id {
			return &All()[i]
		}
	}
	return nil
}

// AutomotivePowertrain 汽车动力总成模板。
// 覆盖：发动机、变速箱、传动轴、驱动轮 — 5 个 part def + 1 个 connection。
var AutomotivePowertrain = Template{
	ID:           "automotive-powertrain",
	Name:         "汽车动力总成 / Automotive Powertrain",
	Industry:     "automotive",
	Description:  "发动机 + 变速箱 + 传动系统的基础 SysML v2 模型，适合汽车动力域入门。",
	PartDefCount: 5,
	Tags:         []string{"汽车", "动力", "入门"},
	Content: `package AutomotivePowertrain {

  part def Engine {
    attribute power : Real = 150.0;
    attribute displacement : Real = 2.0;
    port exhaust : ExhaustPort;
  }

  part def Transmission {
    attribute gearCount : Integer = 6;
    port inputShaft : MechanicalPort;
    port outputShaft : MechanicalPort;
  }

  part def Driveshaft {
    port front : MechanicalPort;
    port rear : MechanicalPort;
  }

  part def Wheel {
    attribute radius : Real = 0.35;
    port hub : MechanicalPort;
  }

  part def Vehicle {
    part engine : Engine;
    part transmission : Transmission;
    part driveshaft : Driveshaft;
    part frontLeft : Wheel;
    part frontRight : Wheel;

    connect engine.exhaust to transmission.inputShaft;
    connect transmission.outputShaft to driveshaft.front;
    connect driveshaft.rear to frontLeft.hub;
  }

  port def ExhaustPort {
    attribute flowRate : Real;
  }

  port def MechanicalPort {
    attribute torque : Real;
    attribute rpm : Real;
  }
}
`,
}

// AerospaceFlightControl 航空飞控系统模板。
// 覆盖：飞控计算机、舵面、作动器、传感器 — 6 个 part def + connection。
var AerospaceFlightControl = Template{
	ID:           "aerospace-flight-control",
	Name:         "航空飞控系统 / Aerospace Flight Control",
	Industry:     "aerospace",
	Description:  "飞控计算机 + 作动器 + 传感器的最小可用 SysML v2 模型，覆盖飞控域核心结构。",
	PartDefCount: 6,
	Tags:         []string{"航空", "飞控", "作动器"},
	Content: `package AerospaceFlightControl {

  part def FlightComputer {
    attribute sampleRateHz : Real = 100.0;
    port cmdIn : CommandPort;
    port sensorIn : SensorPort;
    port actuatorOut : ActuatorPort;
  }

  part def SensorSuite {
    attribute imuCount : Integer = 3;
    port dataOut : SensorPort;
  }

  part def Actuator {
    attribute maxDeflection : Real = 30.0;
    port cmdIn : ActuatorPort;
    port surface : SurfacePort;
  }

  part def ControlSurface {
    attribute area : Real;
    port hinge : SurfacePort;
  }

  part def Airframe {
    part computer : FlightComputer;
    part sensors : SensorSuite;
    part elevator : Actuator;
    part rudder : Actuator;
    part elevatorSurface : ControlSurface;
    part rudderSurface : ControlSurface;

    connect sensors.dataOut to computer.sensorIn;
    connect computer.actuatorOut to elevator.cmdIn;
    connect computer.actuatorOut to rudder.cmdIn;
    connect elevator.surface to elevatorSurface.hinge;
    connect rudder.surface to rudderSurface.hinge;
  }

  port def CommandPort {
    attribute targetPitch : Real;
    attribute targetRoll : Real;
  }

  port def SensorPort {
    attribute pitch : Real;
    attribute roll : Real;
    attribute yaw : Real;
  }

  port def ActuatorPort {
    attribute deflection : Real;
  }

  port def SurfacePort {
    attribute angle : Real;
  }
}
`,
}

// SoftwareMicroservice 软件微服务架构模板。
// 覆盖：API 网关、用户服务、订单服务、数据库 — 7 个 part def。
var SoftwareMicroservice = Template{
	ID:           "software-microservice",
	Name:         "软件微服务架构 / Software Microservice",
	Industry:     "software",
	Description:  "API 网关 + 用户 / 订单 / 库存服务 + 数据库的云原生最小架构模型。",
	PartDefCount: 7,
	Tags:         []string{"软件", "云原生", "微服务"},
	Content: `package SoftwareMicroservice {

  part def APIGateway {
    attribute rateLimitRPS : Integer = 1000;
    port public : HttpPort;
    port userService : HttpPort;
    port orderService : HttpPort;
  }

  part def UserService {
    port http : HttpPort;
    port db : DbPort;
  }

  part def OrderService {
    port http : HttpPort;
    port db : DbPort;
  }

  part def InventoryService {
    port http : HttpPort;
    port db : DbPort;
  }

  part def UserDatabase {
    port conn : DbPort;
  }

  part def OrderDatabase {
    port conn : DbPort;
  }

  part def Platform {
    part gateway : APIGateway;
    part users : UserService;
    part orders : OrderService;
    part inventory : InventoryService;
    part userDb : UserDatabase;
    part orderDb : OrderDatabase;

    connect gateway.userService to users.http;
    connect gateway.orderService to orders.http;
    connect users.db to userDb.conn;
    connect orders.db to orderDb.conn;
  }

  port def HttpPort {
    attribute path : String;
  }

  port def DbPort {
    attribute dsn : String;
  }
}
`,
}