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

// All 返回全部模板（M3 + M6 领域模板）。
// 顺序固定，方便前端按顺序展示。
func All() []Template {
	return []Template{
		AutomotivePowertrain,
		AerospaceFlightControl,
		SoftwareMicroservice,
		// M6 领域模板
		MedicalDevice,
		IndustrialAutomation,
		AutomotiveADAS,
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

// ─── M6 领域模板 ──────────────────────────────────────────────────

// MedicalDevice 医疗设备模板（IEC 62304 合规）。
// 覆盖：生命体征监测器 + 软件组件 + 安全约束 + 需求追溯。
var MedicalDevice = Template{
	ID:           "medical-device",
	Name:         "医疗设备 / Medical Device (IEC 62304)",
	Industry:     "medical",
	Description:  "生命体征监测器系统模型，覆盖 IEC 62304 安全等级划分、需求追溯、约束块。",
	PartDefCount: 6,
	Tags:         []string{"医疗", "IEC 62304", "安全关键"},
	Content: `package MedicalDevice {

  part def VitalSignMonitor {
    attribute safetyClass : String = "Class B";
    part sensor : SensorModule;
    part processor : DataProcessor;
    part display : DisplayModule;
    part alarm : AlarmModule;

    connect sensor.dataOut to processor.sensorIn;
    connect processor.displayOut to display.dataIn;
    connect processor.alarmOut to alarm.triggerIn;
  }

  part def SensorModule {
    attribute samplingRateHz : Real = 250.0;
    port dataOut : SensorDataPort;
  }

  part def DataProcessor {
    attribute algorithmVersion : String = "v2.1";
    port sensorIn : SensorDataPort;
    port displayOut : DisplayPort;
    port alarmOut : AlarmPort;
  }

  part def DisplayModule {
    attribute resolution : String = "1920x1080";
    port dataIn : DisplayPort;
  }

  part def AlarmModule {
    attribute maxDb : Real = 85.0;
    port triggerIn : AlarmPort;
  }

  // 端口定义
  port def SensorDataPort {
    attribute heartRate : Real;
    attribute spO2 : Real;
    attribute temperature : Real;
  }

  port def DisplayPort {
    attribute waveform : String;
    attribute vitals : String;
  }

  port def AlarmPort {
    attribute level : String;
    attribute message : String;
  }

  // M5 需求
  requirement def REQ001 (HR-001) {心率监测精度 ±2 bpm};
  requirement def REQ002 (SpO2-001) {血氧监测精度 ±2%};
  requirement def REQ003 (ALARM-001) {高危报警延迟 < 1秒};
  requirement def REQ004 (SAFETY-001) {单点故障不导致误诊};

  // 追溯关系
  satisfy SensorModule by REQ001;
  satisfy SensorModule by REQ002;
  satisfy AlarmModule by REQ003;
  verify VitalSignMonitor by REQ004;

  // M5 约束块
  constraint def SafetyConstraint {
    attribute maxResponseTime : Real;
    attribute minRedundancy : Integer;
  }
}
`,
}

// IndustrialAutomation 工业自动化模板。
// 覆盖：PLC + 传感器 + 执行器 + 状态机 + 活动图。
var IndustrialAutomation = Template{
	ID:           "industrial-automation",
	Name:         "工业自动化 / Industrial Automation",
	Industry:     "industrial",
	Description:  "PLC 控制系统 + 传送带 + 状态机 + 活动流程，适合离散制造入门。",
	PartDefCount: 5,
	Tags:         []string{"工业", "PLC", "自动化", "状态机"},
	Content: `package IndustrialAutomation {

  part def PLC {
    attribute scanTimeMs : Real = 10.0;
    port sensorIn : SensorPort;
    port actuatorOut : ActuatorPort;
  }

  part def ConveyorBelt {
    attribute speedMPS : Real = 0.5;
    port motor : ActuatorPort;
    port sensor : SensorPort;
  }

  part def RobotArm {
    attribute payloadKg : Real = 10.0;
    port cmd : ActuatorPort;
  }

  part def SensorArray {
    attribute count : Integer = 4;
    port data : SensorPort;
  }

  part def FactoryCell {
    part plc : PLC;
    part conveyor : ConveyorBelt;
    part robot : RobotArm;
    part sensors : SensorArray;

    connect sensors.data to plc.sensorIn;
    connect plc.actuatorOut to conveyor.motor;
    connect plc.actuatorOut to robot.cmd;
  }

  port def SensorPort {
    attribute value : Real;
    attribute unit : String;
  }

  port def ActuatorPort {
    attribute command : String;
    attribute speed : Real;
  }

  // M5 状态机
  state machine ConveyorStateMachine {
    initial state Idle;
    state Running;
    state Paused;
    state Error;

    transition Idle to Running [start];
    transition Running to Paused [pause];
    transition Paused to Running [resume];
    transition Running to Error [fault];
    transition Error to Idle [reset];
  }

  // M5 活动图
  activity ProductionFlow {
    initial action ScanPart;
    action InspectQuality;
    action AcceptPart;
    action RejectPart;
    final action Complete;

    flow ScanPart to InspectQuality;
    flow InspectQuality to AcceptPart [quality=OK];
    flow InspectQuality to RejectPart [quality=NG];
    flow AcceptPart to Complete;
    flow RejectPart to Complete;
  }

  // M5 需求
  requirement def REQ_PROD (PROD-001) {产能 ≥ 100件/小时};
  requirement def REQ_QUAL (QUAL-001) {缺陷率 < 0.1%};

  satisfy ConveyorBelt by REQ_PROD;
  verify FactoryCell by REQ_QUAL;
}
`,
}

// AutomotiveADAS 高级驾驶辅助系统模板。
// 覆盖：雷达/摄像头/超声波传感器 + 融合算法 + 决策 + 执行 + 约束。
var AutomotiveADAS = Template{
	ID:           "automotive-adas",
	Name:         "高级驾驶辅助 / Automotive ADAS",
	Industry:     "automotive",
	Description:  "雷达 + 摄像头 + 传感器融合 + 决策规划 + 执行控制的 ADAS 系统架构。",
	PartDefCount: 7,
	Tags:         []string{"汽车", "ADAS", "自动驾驶", "传感器融合"},
	Content: `package AutomotiveADAS {

  part def RadarSensor {
    attribute rangeM : Real = 250.0;
    attribute fovDeg : Real = 120.0;
    port dataOut : SensorDataPort;
  }

  part def CameraSensor {
    attribute resolutionMP : Real = 8.0;
    port dataOut : SensorDataPort;
  }

  part def UltrasonicSensor {
    attribute rangeM : Real = 5.0;
    port dataOut : SensorDataPort;
  }

  part def SensorFusion {
    port radarIn : SensorDataPort;
    port cameraIn : SensorDataPort;
    port ultrasonicIn : SensorDataPort;
    port fusedOut : FusedDataPort;
  }

  part def DecisionModule {
    attribute algoVersion : String = "v3.2";
    port fusedIn : FusedDataPort;
    port controlOut : ControlPort;
  }

  part def ActuatorController {
    port controlIn : ControlPort;
    port brake : BrakePort;
    port steering : SteeringPort;
  }

  part def ADASSystem {
    part radar : RadarSensor;
    part camera : CameraSensor;
    part ultrasonic : UltrasonicSensor;
    part fusion : SensorFusion;
    part decision : DecisionModule;
    part actuator : ActuatorController;

    connect radar.dataOut to fusion.radarIn;
    connect camera.dataOut to fusion.cameraIn;
    connect ultrasonic.dataOut to fusion.ultrasonicIn;
    connect fusion.fusedOut to decision.fusedIn;
    connect decision.controlOut to actuator.controlIn;
  }

  port def SensorDataPort {
    attribute timestamp : Real;
    attribute confidence : Real;
  }

  port def FusedDataPort {
    attribute objects : String;
    attribute tracks : String;
  }

  port def ControlPort {
    attribute brakePressure : Real;
    attribute steeringAngle : Real;
  }

  port def BrakePort {
    attribute pressure : Real;
  }

  port def SteeringPort {
    attribute angle : Real;
  }

  // M5 需求
  requirement def REQ_AEB (AEB-001) {自动紧急制动响应 < 150ms};
  requirement def REQ_LKA (LKA-001) {车道保持精度 ±10cm};
  requirement def REQ_FUSION (FUS-001) {传感器融合延迟 < 50ms};

  satisfy DecisionModule by REQ_AEB;
  satisfy DecisionModule by REQ_LKA;
  satisfy SensorFusion by REQ_FUSION;

  // M5 约束块
  constraint def TimingConstraint {
    attribute maxLatencyMs : Real;
    attribute minUpdateRateHz : Real;
  }
}
`,
}