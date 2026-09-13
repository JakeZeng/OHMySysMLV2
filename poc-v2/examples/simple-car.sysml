// 简单车辆示例
// 展示：part def、attribute、port、part usage、connect

package Vehicle {
  part def Wheel {
    attribute diameter : Real;
    attribute pressure : Real;
  }

  part def Engine {
    attribute displacement : Real;
    port powerOut : Power;
  }

  part def Car {
    attribute mass : Real;
    attribute vin : String;
    part engine : Engine;
    part wheels[4] : Wheel;
  }

  port def Power {
    in voltage : Real;
    in current : Real;
  }

  part carA : Car {
    port :>> powerOut;
  }

  part carB : Car {
    port :>> powerOut;
  }

  connect carA.powerOut to carB.powerOut;
}
