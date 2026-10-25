/**
 * M19 需求①：SysML v2 官方语法符合性回归。
 *
 * ## 为什么要有这个文件
 *
 * 需求①是「必须满足 SysML v2 规范」。但「凭记忆补语法」是这轮踩过最大的坑 ——
 * 之前把 `transition … to …` 当成官方写法（官方其实是 `then`）、
 * 把 `ItemUsage.referenced` 当成官方关键字（官方 JSON Schema 里根本没有这个
 * 属性，官方真正用的是 `~` 引用标记）。
 *
 * 所以本文件的每条用例都**逐字抄自 OMG 官方参考模型**
 * （`ptc/25-04-31.sysml`，Simple Vehicle Model），并在注释里标出官方行号。
 * 官方模型下载自 OMG 官网，与 `ptc/25-04-32` JSON Schema 同批发布。
 *
 * ## 覆盖范围
 *
 * | 官方构造 | 官方行号 | 本文件用例 |
 * |---|---|---|
 * | `attribute x :> T;`（`:>` 特化） | 21 | 1 |
 * | `occurrence X [*] nonunique;` | 463 | 2 |
 * | `flow of Fuel from a.b to c.d;` | 321 | 3 |
 * | `flow X from a.b to c.d;` | 737 | 4 |
 * | `flow from a.b to c.d;` | 1230 | 5 |
 * | `first a.b then c.d;` | 780 | 6 |
 * | `port x : ~T;`（`~` 引用标记） | 116 | 7 |
 * | `perform action x;` | 35 | 8 |
 * | `exhibit state X parallel { … }` | 41 | 9 |
 * | `transition X then Y;` | 54 | 10 |
 * | `transition 'off-on' first off … then on;` | 170 | 11 |
 * | `attribute :>> x;`（前缀式重定义） | 193 | 12 |
 * | `port x redefines y { … }` | 566 | 13 |
 * | `ref item x:T { … }` | 192 | 14 |
 * | `end #logical x;`（命名空间端点） | 339 | 15 |
 * | `require constraint { … }` | 379 | 16 |
 * | `enum = 60 [mm];` | 417 | 17 |
 * | `attribute x: T = 80 [mm];` | 420 | 18 |
 * | `in item x:T;` | 226 | 19 |
 * | `out item x[*]:T;` | 275 | 20 |
 * | `out item x:T subsets y;` | 278 | 21 |
 * | `interface X:T [5] connect a.b to c.d;` | 333 | 22 |
 * | `assert constraint x { … }` | 199 | 23 |
 * | `constraint { … }`（匿名约束） | 52 | 24 |
 * | `state X[*] nonunique;` | 456 | 25 |
 * | `actor driver;` | 1339 | 26 |
 *
 * —— 下面这批是「官方模型整篇解析通过」那轮补进去的构造（第 29 条起）——
 *
 * | 官方构造 | 官方行号 | 本文件用例 |
 * |---|---|---|
 * | `action x:T { in item …; }`（带类型 + 体） | 726 | 29 |
 * | `action x send p via q { … }` | 755 | 30 |
 * | `action x accept p:T via q;` | 758 | 31 |
 * | `perform action x { … }`（带体） | 754 | 32 |
 * | `message of p:T from a to b;` | 781 | 33 |
 * | `message sendSensedSpeed of T from a.b.c to d.e.f;` | 816 | 34 |
 * | `event occurrence x;` / `event x.y;` | 778 / 829 | 35 |
 * | `event occurrence x = path;`（带绑定） | 800 | 36 |
 * | `then action x { … }` / `then event x.y;` | 1230 / 841 | 37 |
 * | `first start;` / `then fork f1;` | 1385 / 1420 | 38 |
 * | `join j1;` | 1409 | 39 |
 * | `part x:>T = path { … }`（默认值 = 路径） | 1472 | 40 |
 * | `variation part def X:>T { variant part …; }` | 1484 | 41 |
 * | `variation attribute x:T { variant attribute …; }` | 1497 | 42 |
 * | `individual a:T { timeslice … { snapshot … } }` | 1254 | 43 |
 * | `port :>>p:T { port q :>> q [5]; }` | 943 | 44 |
 * | `connect [1] a ::> b to [1] c ::> d;` | 968 | 45 |
 * | `#derivation connection { end #a ::> x; }` | 918 | 46 |
 * | `attribute def X :> Y { attribute w[1..*] { … } }` | 1049 | 47 |
 * | `@Rationale about p::q{ explanation = …; }` | 1121 | 48 |
 * | `part x {@Safety{isMandatory = true;}}` | 685 | 49 |
 * | `concern def X { doc 注释 stakeholder s:T; }` | 1549 | 50 |
 * | `view def X:>Y { filter @SysML::PartUsage; }` | 1563 | 51 |
 * | `allocate a to b { allocate c.d to e.f; }` | 507 | 52 |
 * | `subject x redefines x = path;` | 654 | 53 |
 * | `analysis a { objective o { require r; } return attribute x:T=v; }` | 1093 | 54 |
 * | `calc def X { in a:T; return eval:Real; }` | 1149 | 55 |
 * | `dependency from a to b;` / `#refinement dependency a to b::c;` | 863 / 937 | 56 |
 * | `verification v { verify r { … } }` | 1219 | 57 |
 * | `requirement <'1'> r:T { subject x; }` | 867 | 58 |
 * | `assume constraint { … }` | 886 | 59 |
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';

/** 解析并断言无错误；返回 model 供进一步断言。 */
function ok(src: string) {
  const r = parse(src);
  expect(r.errors, r.errors[0]?.message).toHaveLength(0);
  return r.model;
}

/** 找出第一个指定 kind 的节点（深度优先）。 */
function findByKind<T = any>(node: any, kind: string): T | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const x of node) {
      const hit = findByKind<T>(x, kind);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node.kind === kind) return node as T;
  for (const v of Object.values(node)) {
    const hit = findByKind<T>(v, kind);
    if (hit) return hit;
  }
  return undefined;
}

/** 收集所有指定 kind 的节点。 */
function allByKind<T = any>(node: any, kind: string, out: T[] = []): T[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const x of node) allByKind<T>(x, kind, out);
    return out;
  }
  if (node.kind === kind) out.push(node as T);
  for (const v of Object.values(node)) allByKind<T>(v, kind, out);
  return out;
}

describe('M19 需求①：SysML v2 官方语法（逐条抄自 OMG ptc/25-04-31.sysml）', () => {
  it('1. attribute 的 `:>` 特化形式（官方第 21 行）', () => {
    const m = ok('package P { part def V { attribute mass :> ISQ::mass; } }');
    const attr = findByKind(m, 'attributeUsage');
    expect(attr?.typeRef).toBe('ISQ::mass');
  });

  it('2. occurrence usage 带多重性与 nonunique（官方第 463 行）', () => {
    const m = ok('package P { occurrence logicalOccurrences [*] nonunique; }');
    const occ = findByKind(m, 'occurrenceUsage');
    expect(occ?.name).toBe('logicalOccurrences');
    expect(occ?.isUnique).toBe(false);
  });

  it('3. flow 带载荷类型 + from/to + 点路径端点（官方第 321 行）', () => {
    const m = ok(
      'package P { part def F { flow of Fuel from fuelOutPort.fuel to fuelInPort.fuel; } }',
    );
    const flow = findByKind(m, 'flowUsage');
    expect(flow?.payloadType).toBe('Fuel');
    expect(flow?.source).toBe('fuelOutPort.fuel');
    expect(flow?.target).toBe('fuelInPort.fuel');
  });

  it('4. flow 带名字 + from/to（官方第 737 行）', () => {
    const m = ok(
      'package P { part def F { flow generateToAmplify from generateTorque.engineTorque to amplifyTorque.engineTorque; } }',
    );
    const flow = findByKind(m, 'flowUsage');
    expect(flow?.name).toBe('generateToAmplify');
    expect(flow?.source).toBe('generateTorque.engineTorque');
  });

  it('5. flow 无名字无载荷 + from/to（官方第 1230 行）', () => {
    const m = ok(
      'package P { part def F { flow from weighVehicle.massMeasured to evaluatePassFail.massMeasured; } }',
    );
    const flow = findByKind(m, 'flowUsage');
    expect(flow?.name).toBeUndefined();
    expect(flow?.source).toBe('weighVehicle.massMeasured');
  });

  it('6. succession as usage：`first a.b then c.d;`（官方第 780 行）', () => {
    const m = ok(
      'package P { part def D { first vehicle.doorClosed then driver.driverReady; } }',
    );
    const succ = findByKind(m, 'successionAsUsage');
    expect(succ?.source).toBe('vehicle.doorClosed');
    expect(succ?.target).toBe('driver.driverReady');
  });

  it('7. `~` 引用标记（官方第 116 行）', () => {
    const m = ok('package P { part def E { port engineControlPort: ~ControlPort; } }');
    const port = findByKind(m, 'portUsage');
    expect(port?.typeRef).toBe('ControlPort');
    expect(port?.isReference).toBe(true);
  });

  it('8. perform action（官方第 35 行）', () => {
    const m = ok('package P { part def V { perform action providePower; } }');
    const perf = findByKind(m, 'performUsage');
    expect(perf?.name).toBe('providePower');
  });

  it('9. exhibit state + parallel + 嵌套状态（官方第 41 行）', () => {
    const m = ok(
      'package P { part def V { exhibit state vehicleStates parallel { state operatingStates { state off; } } } }',
    );
    const ex = findByKind(m, 'exhibitStateUsage');
    expect(ex?.name).toBe('vehicleStates');
    expect(ex?.isParallel).toBe(true);
    expect(ex?.states?.[0]?.name).toBe('operatingStates');
    // 嵌套状态体
    expect(ex?.states?.[0]?.nested?.states?.[0]?.name).toBe('off');
  });

  it('10. transition 的官方 `then` 写法（官方第 54 行）', () => {
    const m = ok('package P { state machine SM { state off; transition initial then off; } }');
    const tr = findByKind(m, 'transition');
    expect(tr?.source).toBe('initial');
    expect(tr?.target).toBe('off');
  });

  it('11. 带引号名字 + first/accept/if/do/then 的官方 transition（官方第 170 行）', () => {
    const m = ok(
      `package P { part def V { exhibit state S {
         transition 'off-on'
             first off
             accept StartSignal
             then on;
       } } }`,
    );
    const tr = findByKind(m, 'transition');
    expect(tr?.name).toBe('off-on');
    expect(tr?.source).toBe('off');
    expect(tr?.target).toBe('on');
    expect(tr?.trigger).toBe('StartSignal');
  });

  it('12. attribute 的前缀式重定义 `attribute :>> x;`（官方第 193 行）', () => {
    const m = ok('package P { part def T { attribute :>> fuelMass; } }');
    const attr = findByKind(m, 'attributeUsage');
    expect(attr?.name).toBe('fuelMass');
    expect(attr?.redefines).toBe('fuelMass');
  });

  it('13. port 的后缀式重定义 `port x redefines y { … }`（官方第 566 行）', () => {
    const m = ok(
      'package P { part def V { port vehicleToRoadPort redefines vehicleToRoadPort { port wheelToRoadPort1:WheelToRoadPort; } } }',
    );
    const port = findByKind(m, 'portUsage');
    expect(port?.name).toBe('vehicleToRoadPort');
    expect(port?.redefines).toBe('vehicleToRoadPort');
  });

  it('14. `ref item x:T { … }`（官方第 192 行）', () => {
    const m = ok(
      'package P { part def T { ref item fuel:Fuel { attribute :>> fuelMass; } } }',
    );
    const ref = findByKind(m, 'referenceUsage');
    expect(ref?.name).toBe('fuel');
    expect(ref?.typeRef).toBe('Fuel');
    // 体里的重定义属性
    const attr = findByKind(m, 'attributeUsage');
    expect(attr?.redefines).toBe('fuelMass');
  });

  it('15. allocation def + 命名空间端点 `end #logical x;`（官方第 338-341 行）', () => {
    const m = ok(
      `package P { allocation def LogicalToPhysical{
         end #logical logicalEnd;
         end #physical physicalEnd;
       } }`,
    );
    const ends = allByKind(m, 'connectorEnd');
    expect(ends).toHaveLength(2);
    expect(ends[0].isNamespace).toBe(true);
    expect(ends[0].name).toBe('logical');
    expect(ends[0].target).toBe('logicalEnd');
  });

  it('16. requirement body 的 `require constraint { … }`（官方第 379 行）', () => {
    const m = ok(
      'package P { requirement def MassRequirement { attribute massRequired:>ISQ::mass; require constraint {massActual<=massRequired} } }',
    );
    const cb = findByKind(m, 'constraintBlock');
    expect(cb?.expression).toBe('massActual<=massRequired');
  });

  it('17. enum 字面量 `enum = 60 [mm];`（官方第 417 行）', () => {
    const m = ok('package P { enum def DiameterChoices { enum = 60 [mm]; enum = 80 [mm]; } }');
    const en = findByKind(m, 'enumDef');
    expect(en?.values).toEqual(['60 [mm]', '80 [mm]']);
  });

  it('18. 属性默认值带单位 `= 80 [mm]`（官方第 420 行）', () => {
    const m = ok(
      'package P { part def E { attribute cylinderDiameter: DiameterChoices = 80 [mm]; } }',
    );
    const attr = findByKind(m, 'attributeUsage');
    expect(attr?.defaultValue).toBe('80 [mm]');
  });

  it('19. port 里的 `in item x:T;`（官方第 226 行）', () => {
    const m = ok('package P { port def IgnitionCmdPort { in item ignitionCmd:IgnitionCmd; } }');
    const attr = findByKind(m, 'attributeUsage');
    expect(attr?.name).toBe('ignitionCmd');
    expect(attr?.direction).toBe('in');
  });

  it('20. `out item x[*]:T;`（多重性在名字与类型之间，官方第 275 行）', () => {
    const m = ok('package P { port def DriverCmdPort { out item driverCmd[*]:DriverCmd; } }');
    const attr = findByKind(m, 'attributeUsage');
    expect(attr?.name).toBe('driverCmd');
    expect(attr?.direction).toBe('out');
  });

  it('21. subsetting 子句 `out item x:T subsets y;`（官方第 278 行）', () => {
    const m = ok(
      'package P { port def HandPort { out item ignitionCmd:IgnitionCmd subsets driverCmd; } }',
    );
    const attr = findByKind(m, 'attributeUsage');
    expect(attr?.subsets).toBe('driverCmd');
  });

  it('22. interface 用法 + 无花括号体 + connect（官方第 333 行）', () => {
    const m = ok(
      `package P { interface wheelFastenerInterface:WheelFastenerInterface [5]
         connect lugNutCompositePort.lugNutPort to shankCompositePort.shankPort; }`,
    );
    const iface = findByKind(m, 'interfaceUsage');
    expect(iface?.name).toBe('wheelFastenerInterface');
    expect(iface?.typeRef).toBe('WheelFastenerInterface');
    expect(iface?.body?.length).toBeGreaterThan(0);
  });

  it('23. assert constraint（官方第 199 行）', () => {
    const m = ok(
      'package P { part def F { assert constraint fuelConstraint {fuel.fuelMass<=fuelMassMax} } }',
    );
    const cb = findByKind(m, 'constraintBlock');
    expect(cb?.name).toBe('fuelConstraint');
    expect(cb?.expression).toBe('fuel.fuelMass<=fuelMassMax');
  });

  it('24. 匿名约束 `constraint { … }`（官方第 52 行）', () => {
    const m = ok('package P { part def V { state on { constraint {electricalPower<=500[W]} } } }');
    const cb = findByKind(m, 'constraintBlock');
    expect(cb?.expression).toBe('electricalPower<=500[W]');
  });

  it('25. state usage 带多重性与 nonunique（官方第 456 行）', () => {
    const m = ok('package P { state failureModes[*] nonunique; }');
    const st = findByKind(m, 'stateDef');
    expect(st?.name).toBe('failureModes');
    expect(st?.isUnique).toBe(false);
  });

  it('26. actor usage（官方第 1339 行）', () => {
    const m = ok('package P { actor driver; }');
    const actor = findByKind(m, 'actorUsage');
    expect(actor?.name).toBe('driver');
  });

  it('27. 官方 `transition` 的 `to` 历史写法仍可用（不破坏存量内容）', () => {
    const m = ok('package P { state machine SM { state off; transition initial to off; } }');
    const tr = findByKind(m, 'transition');
    expect(tr?.target).toBe('off');
  });

  it('28. 官方 `flow a to b;` 历史写法仍可用（不破坏存量内容）', () => {
    const m = ok('package P { activity A { action a; action b; flow a to b; } }');
    const flow = findByKind(m, 'flowUsage');
    expect(flow?.source).toBe('a');
    expect(flow?.target).toBe('b');
  });

  it('28b. `flow` 的 kind 是官方元类 FlowUsage —— 官方没有 ControlFlow', () => {
    // 官方 JSON Schema（ptc/25-04-32）里 `ControlFlow` 出现 **0 次**，
    // 只有 Flow / FlowUsage / FlowDefinition / FlowEnd。
    // 改造前本项目一律落成 `controlFlow`（早期草案的说法）→ 非官方元类。
    const m = ok('package P { part def F { flow of Fuel from a.b to c.d; } }');
    expect(findByKind(m, 'flowUsage'), 'flow 应当是官方元类 FlowUsage').toBeTruthy();
    expect(findByKind(m, 'controlFlow'), '官方没有 ControlFlow 这个元类').toBeFalsy();
  });

  it('29. action usage 带类型 + 体（官方第 726 行）', () => {
    const m = ok(
      'package P { part def V { action providePower:ProvidePower { in item fuelCmd:FuelCmd redefines pwrCmd; } } }',
    );
    const act = findByKind(m, 'actionUsage');
    expect(act?.name).toBe('providePower');
    expect(act?.typeRef).toBe('ProvidePower');
    const inItem = allByKind(m, 'attributeUsage').find((a) => a.name === 'fuelCmd');
    expect(inItem?.direction).toBe('in');
    expect(inItem?.redefines).toBe('pwrCmd');
  });

  it('30. send action：`action x send p via q { … }`（官方第 755 行）', () => {
    const m = ok(
      'package P { part def V { action turnVehicleOn send ignitionCmd via driver.p1 { in ignitionCmd:IgnitionCmd; } } }',
    );
    const act = findByKind(m, 'sendActionUsage');
    expect(act?.name).toBe('turnVehicleOn');
    expect(act?.payload?.name).toBe('ignitionCmd');
    expect(act?.via).toBe('driver.p1');
    expect(act?.body?.length).toBe(1);
  });

  it('31. accept action：`action x accept p:T via q;`（官方第 758 行）', () => {
    const m = ok(
      'package P { part def V { action trigger1 accept ignitionCmd:IgnitionCmd via vehicle.ignitionCmdPort; } }',
    );
    const act = findByKind(m, 'acceptActionUsage');
    expect(act?.name).toBe('trigger1');
    expect(act?.payload?.name).toBe('ignitionCmd');
    expect(act?.payload?.typeRef).toBe('IgnitionCmd');
    expect(act?.via).toBe('vehicle.ignitionCmdPort');
  });

  it('32. perform action 带体（官方第 754 行）', () => {
    const m = ok(
      'package P { part def V { perform action startVehicle { action turnVehicleOn; } } }',
    );
    const perf = findByKind(m, 'performUsage');
    expect(perf?.name).toBe('startVehicle');
    expect(perf?.body?.[0]?.kind).toBe('actionUsage');
  });

  it('33. message usage：`message of p:T from a to b;`（官方第 781 行）', () => {
    const m = ok(
      'package P { part def V { message of ignitionCmd:IgnitionCmd from driver.turnVehicleOn to vehicle.trigger1; } }',
    );
    const msg = findByKind(m, 'messageUsage');
    expect(msg?.name).toBe('ignitionCmd');
    expect(msg?.payloadType).toBe('IgnitionCmd');
    expect(msg?.source).toBe('driver.turnVehicleOn');
    expect(msg?.target).toBe('vehicle.trigger1');
  });

  it('34. message usage 带名字 + 多段点路径（官方第 816 行）', () => {
    const m = ok(
      'package P { part def V { message sendSensedSpeed of SensedSpeed from a.b.c to d.e.f; } }',
    );
    const msg = findByKind(m, 'messageUsage');
    expect(msg?.name).toBe('sendSensedSpeed');
    expect(msg?.payloadType).toBe('SensedSpeed');
    expect(msg?.source).toBe('a.b.c');
    expect(msg?.target).toBe('d.e.f');
  });

  it('35. event occurrence 与点路径 event（官方第 778 / 829 行）', () => {
    const m = ok(
      'package P { part def V { event occurrence doorClosed; event sendSensedSpeed.source; } }',
    );
    const evs = allByKind(m, 'eventOccurrence');
    expect(evs).toHaveLength(2);
    expect(evs[0].name).toBe('doorClosed');
    expect(evs[1].name).toBe('sendSensedSpeed.source');
  });

  it('36. event occurrence 带绑定值（官方第 800 行）', () => {
    const m = ok(
      'package P { part def V { event occurrence setSpeedReceived = vehicle_b.setSpeedPort.setSpeedReceived; } }',
    );
    const ev = findByKind(m, 'eventOccurrence');
    expect(ev?.name).toBe('setSpeedReceived');
    expect(ev?.bound).toBe('vehicle_b.setSpeedPort.setSpeedReceived');
  });

  it('37. `then action x { … }` 与 `then event x.y;`（官方第 1230 / 841 行）', () => {
    const m = ok(
      'package P { part def A { then action evaluatePassFail { in massMeasured:>ISQ::mass; } then event sendSensedSpeed.target; } }',
    );
    const succs = allByKind(m, 'successionAsUsage');
    expect(succs).toHaveLength(2);
    expect(succs[0].target).toBe('evaluatePassFail');
    expect(succs[0].body?.length).toBe(1);
    expect(succs[1].target).toBe('sendSensedSpeed.target');
  });

  it('38. `first start;` 与 `then fork fork1;`（官方第 1385 / 1420 行）', () => {
    const m = ok('package P { part def V { first start; then fork fork1; } }');
    const succs = allByKind(m, 'successionAsUsage');
    expect(succs).toHaveLength(2);
    expect(succs[0].target).toBe('start');
    expect(succs[1].target).toBe('fork1');
  });

  it('39. join usage（官方第 1409 行）', () => {
    const m = ok('package P { part def V { join join1; } }');
    const join = findByKind(m, 'joinUsage');
    expect(join?.name).toBe('join1');
  });

  it('40. part usage 带默认值（指向已有实例的路径，官方第 1472 行）', () => {
    const m = ok(
      'package P { part def V { part vehicle_b_1:>vehicle_b = transportPassenger.vehicle { attribute x = 1; } } }',
    );
    const part = findByKind(m, 'partUsage');
    expect(part?.name).toBe('vehicle_b_1');
    expect(part?.defaultValue).toBe('transportPassenger.vehicle');
    expect(part?.body?.length).toBe(1);
  });

  it('41. variation part def + variant part（官方第 1484 / 1493 行）', () => {
    const m = ok(
      'package P { variation part def TransmissionChoices:>Transmission { variant part transmissionAutomatic:TransmissionAutomatic; } }',
    );
    const vardef = findByKind(m, 'variationDef');
    expect(vardef?.name).toBe('TransmissionChoices');
    expect(vardef?.inherits).toEqual(['Transmission']);
    const variant = findByKind(m, 'variantUsage');
    expect(variant?.name).toBe('transmissionAutomatic');
  });

  it('42. variation attribute + 嵌套 variant attribute（官方第 1497 行）', () => {
    const m = ok(
      'package P { part def V { variation attribute diameter:LengthValue { variant attribute smallDiameter:LengthValue; } } }',
    );
    const outer = allByKind(m, 'variantAttributeUsage');
    expect(outer).toHaveLength(2);
    expect(outer[0].name).toBe('diameter');
    expect(outer[0].typeRef).toBe('LengthValue');
    expect(outer[0].body?.[0]?.name).toBe('smallDiameter');
  });

  it('43. individual + timeslice + snapshot（官方第 1254 行）', () => {
    const m = ok(
      'package P { individual a:VehicleRoadContext_1 { timeslice t0_t2_a { snapshot t0_a { attribute t0 redefines time=0 [s]; } } } }',
    );
    const ind = findByKind(m, 'individualUsage');
    expect(ind?.name).toBe('a');
    expect(ind?.typeRef).toBe('VehicleRoadContext_1');
    expect(ind?.body?.[0]?.kind).toBe('timesliceUsage');
    expect(ind?.body?.[0]?.body?.[0]?.kind).toBe('snapshotDef');
  });

  it('44. port 的 `:>>` 重定义 + 嵌套 port（官方第 943 行）', () => {
    const m = ok(
      'package P { part def V { port :>>lugNutCompositePort:LugNutCompositePort { port lugNutPort :>> lugNutPort [5]; } } }',
    );
    const outer = allByKind(m, 'portUsage');
    expect(outer[0].name).toBe('lugNutCompositePort');
    expect(outer[0].redefines).toBe('lugNutCompositePort');
    expect(outer[0].typeRef).toBe('LugNutCompositePort');
    expect(outer[0].body?.[0]?.multiplicity).toBe('5');
  });

  it('45. connect 的 `::>` 命名空间端点 + 多重性（官方第 968 行）', () => {
    const m = ok(
      'package P { part def V { connect [1] lugNutCompositePort ::> wheel1.lugNutCompositePort to [1] shankCompositePort ::> hub1.shankCompositePort; } }',
    );
    const conn = findByKind(m, 'connection');
    expect(conn?.source?.partName).toBe('lugNutCompositePort');
    expect(conn?.source?.redefines).toBe('wheel1.lugNutCompositePort');
    expect(conn?.sourceMultiplicity).toBe('1');
    expect(conn?.target?.redefines).toBe('hub1.shankCompositePort');
  });

  it('46. connection def + `::>` 端点（官方第 918 行）', () => {
    const m = ok(
      'package P { #derivation connection { end #original ::> vehicleSpecification.vehicleMassRequirement; end #derive ::> engineSpecification.engineMassRequirement; } }',
    );
    const ends = allByKind(m, 'connectorEnd');
    expect(ends).toHaveLength(2);
    expect(ends[0].name).toBe('original');
    expect(ends[0].isNamespace).toBe(true);
    expect(ends[0].redefines).toBe('vehicleSpecification.vehicleMassRequirement');
  });

  it('47. attribute def 带体 + 子属性多重性（官方第 1049 行）', () => {
    const m = ok(
      'package P { attribute def Scenario :> SampledFunction { attribute wayPoint[1..*] { attribute elapseTime[1] :> ISQ::time; } } }',
    );
    const def = findByKind(m, 'attributeDef');
    expect(def?.inherits).toEqual(['SampledFunction']);
    const wayPoint = allByKind(m, 'attributeUsage').find((a) => a.name === 'wayPoint');
    expect(wayPoint?.body?.[0]?.name).toBe('elapseTime');
  });

  it('48. metadata usage 带 about + 赋值（官方第 1121 行）', () => {
    const m = ok(
      'package P { @Rationale about engineTradeOffAnalysis::vehicle_b_engine4cyl{ explanation = VehicleAnalysis::engineTradeOffAnalysis; text = "the engine4cyl was evaluated"; } }',
    );
    const md = findByKind(m, 'metadataUsage');
    expect(md?.name).toBe('Rationale');
    expect(md?.about).toBe('engineTradeOffAnalysis::vehicle_b_engine4cyl');
    const assigns = allByKind(m, 'metadataAssignment');
    expect(assigns.map((a) => a.name)).toEqual(['explanation', 'text']);
  });

  it('49. 内联 metadata usage（官方第 685 行）', () => {
    const m = ok('package P { part def V { part bumper {@Safety{isMandatory = true;}} } }');
    const md = findByKind(m, 'metadataUsage');
    expect(md?.name).toBe('Safety');
    expect(findByKind(m, 'metadataAssignment')?.value).toBe('true');
  });

  it('50. concern def + doc + stakeholder（官方第 1549 行）', () => {
    const m = ok(
      'package P { concern def VehicleSafety { doc /* identify system safety features */ stakeholder se:SafetyEngineer; } }',
    );
    const concern = findByKind(m, 'concernDef');
    expect(concern?.name).toBe('VehicleSafety');
    expect(concern?.body?.some((b: any) => b.kind === 'doc')).toBe(true);
    expect(findByKind(m, 'stakeholderUsage')?.typeRef).toBe('SafetyEngineer');
  });

  it('51. view def 的 `:>` 特化 + filter（官方第 1563 行）', () => {
    const m = ok('package P { view def PartsTreeView:>TreeView { filter @SysML::PartUsage; } }');
    const view = findByKind(m, 'view');
    expect(view?.declKind).toBe('definition');
    expect(view?.specializes).toBe('TreeView');
    expect(view?.filters).toEqual(['@SysML::PartUsage']);
  });

  it('52. allocation usage + 嵌套 allocate（官方第 507 行）', () => {
    const m = ok(
      'package P { allocation a:LogicalToPhysical { allocate vehicleLogical to vehicle_b { allocate vehicleLogical.torqueGenerator to vehicle_b.engine; } } }',
    );
    const allocUse = findByKind(m, 'allocationUsage');
    expect(allocUse?.typeRef).toBe('LogicalToPhysical');
    const allocs = allByKind(m, 'allocation');
    expect(allocs).toHaveLength(2);
    expect(allocs[0].source).toBe('vehicleLogical');
    expect(allocs[0].body?.[0]?.target).toBe('vehicle_b.engine');
  });

  it('53. subject 的 redefines + 默认值（官方第 654 行）', () => {
    const m = ok(
      'package P { part def V { subject generateTorque redefines generateTorque = vehicle_b.engine.generateTorque; } }',
    );
    const subj = findByKind(m, 'subject');
    expect(subj?.name).toBe('generateTorque');
    expect(subj?.redefines).toBe('generateTorque');
    expect(subj?.value).toBe('vehicle_b.engine.generateTorque');
  });

  it('54. analysis usage + objective + return（官方第 1093 行）', () => {
    const m = ok(
      'package P { analysis fuelEconomyAnalysis { subject = vehicle_b; objective fuelEconomyAnalysisObjective { require vehicleSpecification.vehicleFuelEconomyRequirements; } return attribute calculatedFuelEconomy:>distancePerVolume=FuelConsumption(f_a, f_b); } }',
    );
    const analysis = findByKind(m, 'analysisUsage');
    expect(analysis?.name).toBe('fuelEconomyAnalysis');
    const obj = findByKind(m, 'objective');
    expect(obj?.name).toBe('fuelEconomyAnalysisObjective');
    expect(findByKind(m, 'requireStatement')?.name).toBe(
      'vehicleSpecification.vehicleFuelEconomyRequirements',
    );
    const ret = findByKind(m, 'returnValue');
    expect(ret?.name).toBe('calculatedFuelEconomy');
    expect(ret?.typeRef).toBe('distancePerVolume');
    expect(ret?.defaultValue).toBe('FuelConsumption(f_a, f_b)');
  });

  it('55. calc def + return（官方第 1149 行）', () => {
    const m = ok('package P { calc def EngineEvaluation { in engineMass:>ISQ::mass; return eval:Real; } }');
    const calc = findByKind(m, 'calcDefinition');
    expect(calc?.name).toBe('EngineEvaluation');
    expect(findByKind(m, 'returnValue')?.typeRef).toBe('Real');
  });

  it('56. dependency 的两种官方写法（官方第 863 / 937 行）', () => {
    const m1 = ok('package P { dependency from vehicleSpecification to marketSurvey; }');
    const dep1 = findByKind(m1, 'dependencyUsage');
    expect(dep1?.source).toBe('vehicleSpecification');
    expect(dep1?.target).toBe('marketSurvey');

    const m2 = ok(
      'package P { #refinement dependency engine4Cyl to VehicleConfiguration_b::PartsTree::vehicle_b::engine; }',
    );
    const dep2 = findByKind(m2, 'dependencyUsage');
    expect(dep2?.name).toBe('refinement');
    expect(dep2?.source).toBe('engine4Cyl');
    expect(dep2?.target).toBe('VehicleConfiguration_b::PartsTree::vehicle_b::engine');
  });

  it('57. verification usage + verify 子句（官方第 1219 行）', () => {
    const m = ok(
      'package P { verification v { verify vehicleSpecification.vehicleMassRequirement { doc /* ok */ } } }',
    );
    const ver = findByKind(m, 'verificationUsage');
    expect(ver?.name).toBe('v');
    const verify = findByKind(m, 'verify');
    expect(verify?.requirement).toBe('vehicleSpecification.vehicleMassRequirement');
  });

  it('58. requirement usage 带引号 id + 类型 + 体（官方第 867 行）', () => {
    const m = ok(
      `package P { requirement <'1'> vehicleMassRequirement: MassRequirement { subject generateTorque; } }`,
    );
    const req = findByKind(m, 'requirementUsage');
    expect(req?.name).toBe('vehicleMassRequirement');
    expect(req?.reqId).toBe('1');
    expect(req?.typeRef).toBe('MassRequirement');
  });

  it('59. `assume constraint { … }`（官方第 886 行）', () => {
    const m = ok('package P { requirement def R { assume constraint {massActual<=massRequired} } }');
    const cb = findByKind(m, 'constraintBlock');
    expect(cb?.expression).toBe('massActual<=massRequired');
  });
});
