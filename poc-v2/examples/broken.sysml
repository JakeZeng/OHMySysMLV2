// 故意写错的示例，用于测试错误信息
// 包含：缺少分号、引用未定义类型、connect 端点不存在、port 方向不匹配

package Broken {
  part def Engine {
    attribute hp : Real
    port fuelIn : FuelPort
  }

  part def Car {
    part engine : Engine
    part wheels[4] : Whel  // typo: 应为 Wheel
  }

  // FuelPort 未定义
  part def FuelSystem {
    port outlet : FuelPort;
  }

  // connect 端点 engineA / engineB 都不存在
  connect engineA.fuelIn to engineB.fuelIn;

  // 端口方向冲突（in ↔ in）
  part def InPort { in v : Real; }
  part def OutPort { in v : Real; }
  part def Device {
    port inp : InPort;
    port outp : OutPort;
  }
  part dev : Device;

  // dev 的 inp(in) → dev 的 outp(in) — 方向不兼容
  connect dev.inp to dev.outp;
}
