// 多包系统示例
// 展示：嵌套 package、跨包引用、多 connect、import

package Powertrain {
  port def FuelPort {
    in flowRate : Real;
  }

  part def Engine {
    attribute horsepower : Real;
    port fuelIn : FuelPort;
    port powerOut : MechanicalPort;
  }

  port def MechanicalPort {
    in torque : Real;
  }

  part engineV6 : Engine {
    port :>> fuelIn;
  }
}

package Chassis {
  part def Wheel {
    attribute radius : Real;
  }

  part def ChassisAssembly {
    part frontLeft : Wheel;
    part frontRight : Wheel;
    part rearLeft : Wheel;
    part rearRight : Wheel;
  }
}

package Vehicle {
  import Powertrain::*;
  import Chassis::*;

  part def Car {
    part engine : Engine;
    part chassis : ChassisAssembly;
  }

  part def FuelSource {
    port fuelPort : FuelPort;
  }

  part myCar : Car;
  part myFuel : FuelSource;

  connect myCar.engine.fuelIn to myFuel.fuelPort;
  connect myCar.engine.powerOut to myCar.chassis.driveshaft;
}
