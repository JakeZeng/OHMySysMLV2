# SysML v2 MBSE 系统元模型详细设计文档

**版本**: 1.0  
**日期**: 2026-09-12  
**参考**: OMG SysML v2 (ptc/25-04-32), Eclipse SysON, KerML 语义规范

---

## 目录

1. [KerML 核心层设计](#1-kerml-核心层设计)
2. [SysML v2 扩展层设计](#2-sysml-v2-扩展层设计)
3. [Profile 机制设计](#3-profile-机制设计)
4. [元素扩展机制](#4-元素扩展机制)
5. [模板工程体系](#5-模板工程体系)
6. [元模型 Registry](#6-元模型-registry)
7. [DSM 支持](#7-dsm-domain-specific-modeling-支持)

---

## 1. KerML 核心层设计

KerML (Kernel Modeling Language) 是 SysML v2 的语义基础层，替代 UML 的 MOF 作为元元模型。它提供了系统建模的核心语义构建块。

### 1.1 核心基类层次

```
Element (基类)
├── Relationship (关系基类)
│   ├── Feature (特征)
│   │   ├── DataFeature (数据特征)
│   │   ├── SubsettingFeature (子集特征)
│   │   └── RedefinitionFeature (重定义特征)
│   ├── Typing (类型化关系)
│   ├── FeatureChaining (特征链)
│   └── Ownership (所有权)
├── Type (类型基类)
│   ├── Classifier (分类器)
│   │   ├── Class (类)
│   │   ├── DataType (数据类型)
│   │   └── Behavior (行为)
│   └── TypeAlias (类型别名)
├── Collection (集合)
│   ├── OrderedSet (有序集)
│   ├── Sequence (序列)
│   └── Bag (多集)
└── Annotation (注解)
    ├── Documentation (文档)
    └── Constraint (约束)
```

### 1.2 关键元类详细说明

#### 1.2.1 Element (元素)

所有 KerML 建模元素的抽象基类。

```keraml
abstract class Element {
    // 元类标识
    attribute id: String[1];
    
    // 元素唯一标识符 (符合 ISO/IEC 11179)
    attribute identifier: String[0..1];
    
    // 元素名称
    attribute name: String[0..1];
    
    // 所属包
    reference owner: Package[0..1];
    
    // 所有权关系
    reference ownership: Ownership[*];
    
    // 特征
    reference ownedFeature: Feature[*];
    
    // 类型化关系
    reference typing: Typing[*];
    
    // 约束条件
    reference constraint: ConstraintUsage[*];
    
    // 注解
    reference annotation: Annotation[*];
    
    // 视图绑定
    reference viewBinding: ViewUsage[0..1];
}
```

#### 1.2.2 Relationship (关系)

所有关系元素的基类。

```kerml
abstract class Relationship {
    // 关系唯一标识
    attribute id: String[1];
    
    // 关系方向
    attribute direction: DirectionKind = out;
    
    // 源端元素
    reference source: Element[1];
    
    // 目标端元素  
    reference target: Element[1];
    
    // 关系元类型
    attribute metaType: RelationshipKind;
}

enum DirectionKind {
    in,
    out,
    inout,
    return,
    none
}

enum RelationshipKind {
    ownership,
    typing,
    reference,
    feature,
    specialization,
    dependency
}
```

#### 1.2.3 Feature (特征)

特征是 KerML 的核心概念，用于描述元素的属性、结构或行为成员。

```kerml
abstract class Feature extends Relationship, Element {
    // 特征类型
    reference type: Type[0..1];
    
    // 多重性
    attribute multiplicity: Multiplicity[1] = 1..1;
    
    // 是否为子集
    reference subsettedFeature: Feature[*];
    
    // 是否为重定义
    reference redefinedFeature: Feature[*];
    
    // 特征链
    reference chaining: FeatureChaining[0..1];
    
    // 唯读性
    attribute isReadOnly: Boolean = false;
    
    // 派生标志
    attribute isDerived: Boolean = false;
    
    // 默认值
    reference defaultValue: Expression[0..1];
}

class Multiplicity {
    attribute lowerBound: Integer[1] = 0;
    attribute upperBound: UnlimitedNatural[1] = 1;
    
    // 验证多重性范围
    constraint validRange {
        lowerBound <= upperBound
    }
}
```

#### 1.2.4 Type (类型)

类型的语义定义。

```kerml
abstract class Type extends Element {
    // 特征定义
    reference ownedFeature: Feature[*];
    
    // 特征引用
    reference memberFeature: Feature[*];
    
    // 类型层级
    reference supertype: Type[*];
    
    // 抽象类型标志
    attribute isAbstract: Boolean = false;
    
    // 覆盖特征
    operation redefineFeature(f: Feature[1]): Feature[1];
}

abstract class Classifier extends Type {
    // 实例化操作
    operation instantiate(): InstanceSpecification;
    
    // 特征匹配
    operation matches(instance: Element[1]): Boolean;
}
```

#### 1.2.5 Collection (集合)

集合类型定义。

```kerml
abstract class Collection extends DataType {
    // 元素类型
    reference elementType: Type[1];
    
    // 集合大小
    attribute size: Integer[0..1];
}

class OrderedSet extends Collection {
    // 有序集合，支持重复检测
}

class Sequence extends Collection {
    // 序列，允许重复，有序
}

class Bag extends Collection {
    // 多集，允许重复，无序
}

class Set extends Collection {
    // 集合，不允许重复
}
```

### 1.3 KerML 语义约束

```kerml
// 循环所有权约束
constraint noCircularOwnership {
    not exists cycle: Element.allInstances()->closure(ownedElement) 
        where cycle->includes(self)
}

// 特征覆盖约束
constraint featureRedefinition {
    self.redefinedFeature->forAll(rf | 
        self.owner = rf.owner or
        self.owner.owningNamespace = rf.owner.owningNamespace
    )
}

// 多重性有效约束
constraint multiplicityEffect {
    multiplicity.lowerBound >= 0 and
    multiplicity.upperBound >= multiplicity.lowerBound
}
```

---

## 2. SysML v2 扩展层设计

SysML v2 在 KerML 基础上定义了特定领域的建模元素。

### 2.1 系统结构建模

#### 2.1.1 Block (结构块)

Block 是 SysML v2 中定义系统结构和属性的核心元素。

```sysml
class Block extends Classifier {
    // 结构特征
    ownedProperty: Property[*];
    
    // 部分定义
    ownedPart: PartProperty[*];
    
    // 参考定义
    ownedReference: ReferenceProperty[*];
    
    // 端口定义
    ownedPort: Port[0..1];
    
    // 流端口
    ownedFlowPort: FlowPort[*];
    
    // 项流
    ownedItemFlow: ItemFlow[*];
    
    // 约束属性
    ownedConstraint: ConstraintProperty[*];
    
    // 分配属性
    ownedAllocation: AllocationUsage[*];
    
    // 参与行为
    participation: Behavior[0..1];
    
    // 嵌套结构
    nestedBlock: Block[*];
    
    // 是否为虚系统
    attribute is虚System: Boolean = false;
    
    // 物理类型分类
    attribute physicalKind: PhysicalKindKind;
}

enum PhysicalKindKind {
    unspecified,
    component,
    equipment,
    material,
    consumable
}
```

#### 2.1.2 Property (属性)

```sysml
class Property extends Feature {
    // 属性类型
    type: Type[0..1];
    
    // 初始值
    defaultValue: Expression[0..1];
    
    // 所属块
    owningBlock: Block[0..1];
    
    // 聚合方式
    aggregationKind: AggregationKind = none;
}

class PartProperty extends Property {
    // 部分性质：整体-部分关系
    reference partType: Block[1];
}

class ReferenceProperty extends Property {
    // 参考性质：引用而非拥有
    reference referenceType: Block[1];
}

class ValueProperty extends Property {
    // 值属性：数值或数据
    reference valueType: DataType[1];
}

enum AggregationKind {
    none,       // 无聚合
    shared,     // 共享聚合
    composite   // 组合聚合
}
```

#### 2.1.3 Port (端口)

```sysml
class Port extends Property {
    // 端口方向
    direction: PortDirectionKind;
    
    // 是否为行为端口
    isBehavior: Boolean = false;
    
    // 是否为分布式端口
    isDistributed: Boolean = false;
    
    // 端口类型（接口）
    reference interface: Interface[0..1];
    
    // 嵌套端口
    nestedPort: Port[*];
}

enum PortDirectionKind {
    in,
    out,
    inout,
    service  // 服务端口
}

class FlowPort extends Port {
    // 流端口类型
    attribute isAtomic: Boolean = true;
    
    // 流项目类型
    reference itemType: Type[1];
    
    // 流方向
    flowDirection: FlowDirectionKind;
}

enum FlowDirectionKind {
    in,
    out,
    inout
}

class ProxyPort extends Port {
    // 代理端口：引用外部接口
    reference protocol: Interface[0..1];
}

class FullPort extends Port {
    // 完整端口：拥有完整接口定义
}
```

#### 2.1.4 Interface (接口)

```sysml
class Interface extends Classifier {
    // 接口契约
    ownedOperation: Operation[*];
    
    // 接口项目
    ownedInterfaceItem: InterfaceItem[*];
    
    // 供需接口标识
    attribute interfaceKind: InterfaceKind;
    
    // 联盟连接
    connector: Connector[*];
}

enum InterfaceKind {
    provided,   // 供接口
    required,  // 需接口
    flow      // 流接口
}

class InterfaceItem extends Property {
    // 接口项目：接口的输入/输出
    attribute direction: InterfaceDirectionKind;
}

class Connector extends Relationship {
    // 连接器：连接端口
    reference source: ConnectableElement[1];
    reference target: ConnectableElement[1];
    
    // 连接类型
    connectorType: ConnectorKind;
    
    // 连接器端
    end: ConnectorEnd[2];
}

class ConnectorEnd {
    reference partWithPort: Property[0..1];
    reference role: ConnectableElement[1];
    reference protocol: Interface[0..1];
}
```

#### 2.1.5 FlowProperty (流属性)

```sysml
class FlowProperty extends Feature {
    // 流属性类型
    reference itemType: Type[1];
    
    // 流方向
    direction: FlowDirectionKind;
    
    // 流速率
    rate: ValueSpecification[0..1];
    
    // 延迟特性
    latency: TimeExpression[0..1];
}
```

### 2.2 需求建模

#### 2.2.1 Requirement (需求)

```sysml
class Requirement extends Classifier {
    // 需求标识
    attribute id: String[1];
    
    // 需求文本
    attribute text: String[1];
    
    // 需求来源
    attribute source: String[0..1];
    
    // 需求优先级
    attribute priority: PriorityKind;
    
    // 需求风险
    attribute risk: RiskKind;
    
    // 需求验证状态
    attribute verificationStatus: VerificationStatusKind;
    
    // 需求验证方法
    verificationMethod: VerificationMethodKind[*];
    
    // 派生自
    derivedFrom: Requirement[*];
    
    // 满足关系
    satisfiedBy: RequirementSatisfaction[*];
    
    // 验证关系
    verifiedBy: RequirementVerification[*];
    
    // 精化关系
    refinedBy: RequirementRefinement[*];
    
    // 包含子需求
    ownedRequirement: Requirement[*];
}

enum PriorityKind {
    critical,
    high,
    medium,
    low
}

enum RiskKind {
    high,
    medium,
    low,
    none
}

enum VerificationStatusKind {
    undefined,
    pass,
    fail,
    inProgress,
    deferred
}

enum VerificationMethodKind {
    analysis,
    inspection,
    demonstration,
    test,
    review
}
```

### 2.3 约束建模

#### 2.3.1 Constraint (约束)

```sysml
class Constraint extends Classifier {
    // 约束表达式
    specification: ValueSpecification[1];
    
    // 约束上下文
    context: Element[0..1];
    
    // 约束状态
    constraintState: ConstraintStateKind;
}

enum ConstraintStateKind {
    enabled,
    disabled,
    failed
}

class ConstraintUsage extends Usage {
    // 约束使用
    reference constraint: Constraint[1];
    
    // 约束参数绑定
    parameterBinding: BindingConnector[*];
}

class ConstraintProperty extends Property {
    // 约束属性：嵌入约束
    reference constraintDef: Constraint[1];
}
```

### 2.4 用例建模

#### 2.4.1 UseCase (用例)

```sysml
class UseCase extends Behavior {
    // 用例主体
    subject: Block[*];
    
    // 用例参与者
    actor: Actor[*];
    
    // 包含用例
    includedUseCase: UseCase[*];
    
    // 扩展用例
    extendingUseCase: UseCase[*];
    
    // 用例场景
    scenario: Scenario[*];
    
    // 用例目标
    objective: Text[0..1];
    
    // 成功标准
    successCriteria: Text[0..1];
}

class Actor extends Classifier {
    // 参与者角色
    role: Classifier[0..1];
    
    // 参与者参与关系
    participation: Participation[*];
}

class Participation extends Relationship {
    reference participant: Element[1];
    reference involvement: InvolvementKind[1];
}

enum InvolvementKind {
    performer,
    initiator,
    observer,
    beneficiary,
    resource
}

class Scenario extends Behavior {
    // 场景类型
    scenarioKind: ScenarioKind;
    
    // 引用用例
    reference useCase: UseCase[1];
}

enum ScenarioKind {
    nominal,
    alternative,
    exception,
    worstCase
}
```

### 2.5 分配建模

#### 2.5.1 Allocation (分配)

```sysml
class Allocation extends Relationship {
    // 源元素（被分配项）
    source: Element[1];
    
    // 目标元素（分配目标）
    target: Element[1];
    
    // 分配类型
    allocationType: AllocationTypeKind;
    
    // 分配状态
    allocationStatus: AllocationStatusKind;
}

enum AllocationTypeKind {
    allocate,
    satisfy,
    realize,
    implement,
    trace
}

enum AllocationStatusKind {
    undefined,
    allocated,
    unallocated,
    partiallyAllocated
}

class AllocationUsage extends Usage {
    // 分配使用
    reference source: Element[1];
    reference target: Element[1];
    
    // 分配视图
    reference allocationView: AllocationView[0..1];
}

class AllocationView extends View {
    // 分配视图定义
    allocatedTypes: Block[*];
}
```

### 2.6 行为建模

#### 2.6.1 Action (行为)

```sysml
class Action extends Behavior {
    // 输入引脚
    inputPin: InputPin[*];
    
    // 输出引脚
    outputPin: OutputPin[*];
    
    // 执行规格
    executionSpecification: ExecutionSpecification[0..1];
    
    // 行为特征
    actionKind: ActionKind;
}

enum ActionKind {
    create,
    destroy,
    assign,
    call,
    send,
    accept,
    behavior,
    opaque
}

class InputPin extends Pin {
    // 输入引脚
    isControl: Boolean = false;
}

class OutputPin extends Pin {
    // 输出引脚
}

class Pin extends ObjectNode {
    // 引脚：行为输入输出
    reference type: Type[0..1];
    multiplicity: Multiplicity[1] = 1..1;
}

class ControlNode extends ObjectNode {
    // 控制节点
    controlKind: ControlKind;
}

enum ControlKind {
    decision,
    merge,
    fork,
    join,
    initial,
    activityFinal,
    flowFinal
}

class AcceptAction extends Action {
    // 接受事件动作
    trigger: Trigger[*];
}

class SendAction extends Action {
    // 发送动作
    reference target: OutputPin[1];
    reference signal: Signal[1];
}

class CallAction extends Action {
    // 调用动作
    reference operation: Operation[1];
}
```

---

## 3. Profile 机制设计

### 3.1 Profile 定义结构

Profile 是扩展 KerML/SysML v2 的标准机制。

```sysml
class Profile extends Package {
    // Profile 元模型引用
    reference metamodelReference: Package[1];
    
    // Profile 定义元素
    ownedStereotype: Stereotype[*];
    
    // Profile 扩展类型
    ownedExtension: Extension[*];
    
    // Profile 应用范围
    applicationScope: Element[*];
}

class Stereotype extends Classifier {
    // 基类扩展
    reference baseClass: Classifier[1];
    
    // 扩展属性
    ownedAttribute: ExtensionProperty[*];
    
    // Profile 引用
    reference owningProfile: Profile[1];
    
    // 图标定义
    icon: Image[0..1];
    
    // 验证约束
    validationRule: Constraint[*];
}

class Extension extends Relationship {
    // 扩展元类
    reference source: Stereotype[1];
    
    // 目标基类
    reference target: Classifier[1];
    
    // 是否必须
    attribute isRequired: Boolean = false;
    
    // 扩展属性
    memberProperty: ExtensionProperty[*];
}

class ExtensionProperty extends Property {
    // 扩展属性定义
    reference defaultValue: ValueSpecification[0..1];
    
    // 属性顺序
    attribute order: Integer = 0;
}
```

### 3.2 标准 Profile

#### 3.2.1 SysML 标准 Profile

```sysml
// 标准 Profile 列表
StandardProfiles = [
    SysMLBasicProfile,
    SysMLRequirementsProfile,
    SysMLStructureProfile,
    SysMLBehaviorProfile,
    SysMLParametricProfile,
    SysMLAllocationProfile,
    SysMLModelLibraryProfile
]

class SysMLBasicProfile extends Profile {
    // 基础类型定义
    ownedStereotype: [
        ElementStereotype,
        ModelElementStereotype
    ];
}

class SysMLRequirementsProfile extends Profile {
    // 需求相关扩展
    ownedStereotype: [
        RequirementStereotype,
        DeriveRequirementStereotype,
        SatisfyRequirementStereotype,
        VerifyRequirementStereotype,
        RefineRequirementStereotype,
        TraceRequirementStereotype
    ];
}

class SysMLStructureProfile extends Profile {
    // 结构相关扩展
    ownedStereotype: [
        BlockStereotype,
        PortStereotype,
        InterfaceStereotype,
        ConnectorStereotype,
        PartStereotype,
        ReferenceStereotype
    ];
}
```

#### 3.2.2 自定义 Profile 示例

```sysml
// 航空系统 Profile
Profile AviationSystemProfile {
    // 飞行器物理分类
    Stereotype PhysicalClassification {
        baseClass: Block;
        attribute classification: ClassificationKind;
        attribute certificationLevel: String;
    }
    
    // 接口符合性
    Stereotype InterfaceCompliance {
        baseClass: Port;
        attribute standard: String;
        attribute version: String;
        attribute certified: Boolean;
    }
    
    // 安全性等级
    Stereotype SafetyLevel {
        baseClass: Requirement;
        attribute level: SafetyLevelKind;
        attribute fhaReference: String;
    }
    
    Extension PhysicalClassification_Block {
        source: PhysicalClassification;
        target: Block;
    }
}

// 使用
@PhysicalClassification(classification = aircraft, certificationLevel = "DO-178C")
block AircraftSystem { ... }
```

### 3.3 Profile 应用流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Profile 应用流程                           │
├─────────────────────────────────────────────────────────────┤
│  1. Profile 定义                                             │
│     ├── 创建 Profile 包                                       │
│     ├── 定义 Stereotype                                      │
│     ├── 定义 Extension                                       │
│     └── 定义约束规则                                          │
│                           ↓                                   │
│  2. Profile 注册                                             │
│     ├── Profile 加载到 Registry                              │
│     ├── 验证 Profile 一致性                                   │
│     └── 注册 Profile 依赖                                    │
│                           ↓                                   │
│  3. Profile 应用                                             │
│     ├── 元素标记 Stereotype                                   │
│     ├── 设置扩展属性值                                       │
│     └── 验证约束条件                                          │
│                           ↓                                   │
│  4. Profile 实例化                                           │
│     ├── 创建 Stereotype 实例                                 │
│     ├── 关联基础元素                                         │
│     └── 继承约束验证                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 元素扩展机制

### 4.1 自定义 Stereotype

```sysml
class CustomStereotype extends Stereotype {
    // 扩展属性
    ownedAttribute: [
        CustomPropertyDefinition[*],
        CustomReferenceDefinition[*],
        CustomConstraintDefinition[*]
    ];
    
    // 约束定义
    ownedConstraint: [
        PreconditionConstraint,
        PostconditionConstraint,
        InvariantConstraint
    ];
    
    // 图标定义
    icon: StereotypeIcon;
    
    // 色彩定义
    color: ColorDefinition[0..1];
    
    // 图形表示
    shape: ShapeDefinition[0..1];
}

class CustomPropertyDefinition extends Property {
    // 属性定义
    attribute propertyType: PropertyTypeKind;
    attribute defaultValue: ValueSpecification[0..1];
    attribute isOrdered: Boolean = false;
    attribute isUnique: Boolean = true;
}

enum PropertyTypeKind {
    string,
    integer,
    real,
    boolean,
    enumeration,
    reference,
    composite
}
```

### 4.2 元素属性扩展

```sysml
// 属性扩展机制
class ElementPropertyExtension {
    // 扩展目标
    reference targetElement: Element[1];
    
    // 扩展定义
    reference extensionDefinition: Stereotype[1];
    
    // 扩展值
    propertyValue: PropertyValue[*];
}

class PropertyValue {
    // 属性名
    attribute name: String[1];
    
    // 属性值
    value: ValueSpecification[1];
    
    // 值类型
    valueType: Type[0..1];
}

class PropertyValueSlot {
    // 属性槽
    reference definingFeature: Feature[1];
    value: ValueSpecification[1];
}

// 示例
@CustomStereotype {
    customProperty = "value1",
    customReference = @SomeReference,
    enumerationProperty = enumValue
}
element CustomElement {
    // ...
}
```

### 4.3 约束扩展

```sysml
class ConstraintExtension {
    // 约束扩展定义
    reference constraintDefinition: Constraint[1];
    
    // 约束参数绑定
    parameterBinding: ParameterBinding[*];
    
    // 约束状态
    constraintState: ConstraintStateKind;
    
    // 评估结果
    evaluationResult: EvaluationResult[0..1];
}

class ParameterBinding {
    reference parameter: Parameter[1];
    reference value: ValueSpecification[1];
}

class ValidationRule {
    // 验证规则定义
    attribute id: String[1];
    attribute name: String[1];
    
    // OCL 表达式
    specification: OCLExpression[1];
    
    // 严重级别
    severity: SeverityKind;
    
    // 错误消息模板
    messageTemplate: String[1];
}

enum SeverityKind {
    error,
    warning,
    info
}
```

### 4.4 视图定义扩展

```sysml
class ViewDefinition extends Element {
    // 视图所属视角
    reference viewpoint: Viewpoint[1];
    
    // 视图内容
    ownedElement: Element[*];
    
    // 可见性规则
    visibilityRule: VisibilityRule[*];
    
    // 过滤规则
    filterRule: FilterRule[*];
    
    // 布局规则
    layoutRule: LayoutRule[*];
}

class Viewpoint {
    // 视角定义
    attribute id: String[1];
    attribute name: String[1];
    
    // 视角语言
    language: String[1];
    
    // 视角目的
    purpose: Text[1];
    
    // 关注点
    concern: Text[*];
    
    // 符号集合
    notationSet: NotationSet[*];
}

class VisibilityRule {
    // 可见性规则
    reference context: Element[1];
    expression: OCLExpression[1];
    
    // 默认可见性
    defaultVisibility: Boolean = true;
}

class FilterRule {
    // 过滤规则
    reference filterFeature: Feature[1];
    expression: OCLExpression[1];
}
```

---

## 5. 模板工程体系

### 5.1 模板类型定义

```sysml
// 模板基类
abstract class Template extends Element {
    // 模板参数
    ownedParameter: TemplateParameter[*];
    
    // 模板约束
    ownedConstraint: Constraint[*];
    
    // 模板用途
    templatePurpose: TemplatePurposeKind;
}

// Block 模板
class BlockTemplate extends Template {
    // 模板化 Block
    reference templatedBlock: Block[1];
    
    // 实例化结果
    instantiationResult: Block[0..1];
}

class ParameterTemplate extends Template {
    // 参数化模板
    ownedParameter: [
        TypeTemplateParameter[*],
        ValueTemplateParameter[*],
        ConstraintTemplateParameter[*]
    ];
}

// Pattern 模板
class PatternTemplate extends Template {
    // 模式模板
    reference pattern: Pattern[1];
    
    // 模式元素映射
    elementMapping: ElementMapping[*];
    
    // 可变元素
    variableElement: Element[*];
}

class Pattern {
    // 模式定义
    attribute id: String[1];
    attribute name: String[1];
    
    // 模式元素
    ownedElement: Element[*];
    
    // 模式连接
    patternConnection: PatternConnection[*];
    
    // 模式约束
    patternConstraint: Constraint[*];
    
    // 模式变体
    variant: PatternVariant[*];
}

class PatternConnection {
    reference source: Element[1];
    reference target: Element[1];
    connectorType: ConnectorKind;
}

// View 模板
class ViewTemplate extends Template {
    // 视图模板
    reference templateViewpoint: Viewpoint[1];
    
    // 视图配置
    viewConfiguration: ViewConfiguration[*];
}
```

### 5.2 模板参数化

```sysml
// 类型模板参数
class TypeTemplateParameter extends TemplateParameter {
    // 参数化类型
    reference parameterType: Type[0..1];
    
    // 默认类型
    reference defaultType: Type[0..1];
    
    // 约束
    ownedConstraint: Constraint[*];
}

// 值模板参数
class ValueTemplateParameter extends TemplateParameter {
    // 值类型
    reference valueType: DataType[1];
    
    // 默认值
    defaultValue: ValueSpecification[0..1];
    
    // 允许的值集合
    allowedValues: ValueSpecification[*];
}

// 约束模板参数
class ConstraintTemplateParameter extends TemplateParameter {
    // 约束类型
    reference constraintType: Constraint[1];
    
    // 默认约束
    defaultConstraint: Constraint[0..1];
}

// 模板参数绑定
class TemplateParameterBinding {
    reference parameter: TemplateParameter[1];
    reference actual: Element[1];
    
    // 参数匹配状态
    matchKind: ParameterMatchKind;
}

enum ParameterMatchKind {
    exact,
    compatible,
    specializable
}

// 模板参数化定义示例
template BlockTemplate<P1 : Type, P2 : ValueProperty>
    : Block {
    // P1 类型属性
    ownedProperty: P1;
    
    // P2 值属性
    ownedProperty: P2;
    
    // 约束
    constraint BlockConstraint {
        specification: P2.value > 0
    }
}
```

### 5.3 模板实例化

```sysml
class TemplateInstantiation {
    // 模板实例化定义
    reference template: Template[1];
    
    // 参数绑定
    parameterBinding: TemplateParameterBinding[*];
    
    // 实例化结果
    result: Element[1];
    
    // 实例化时间戳
    instantiationTime: DateTime[1];
    
    // 实例化状态
    instantiationState: InstantiationStateKind;
}

enum InstantiationStateKind {
    pending,
    inProgress,
    completed,
    failed
}

// 实例化过程
operation instantiate(
    template: Template[1],
    binding: TemplateParameterBinding[*]
): Element {
    // 1. 参数验证
    validateBinding(template, binding);
    
    // 2. 创建实例
    instance = createInstance(template);
    
    // 3. 参数替换
    substituteParameters(instance, binding);
    
    // 4. 约束检查
    checkConstraints(instance);
    
    // 5. 清理模板参数
    removeTemplateParameters(instance);
    
    return instance;
}
```

### 5.4 模板市场

```sysml
class TemplateMarketplace {
    // 模板注册表
    registeredTemplate: RegisteredTemplate[*];
    
    // 模板分类
    templateCategory: TemplateCategory[*];
    
    // 模板版本管理
    templateVersion: TemplateVersion[*];
}

class RegisteredTemplate {
    // 注册模板
    reference template: Template[1];
    
    // 模板元数据
    attribute id: String[1];
    attribute name: String[1];
    attribute description: Text[0..1];
    attribute author: String[0..1];
    attribute version: String[1];
    
    // 标签
    tag: String[*];
    
    // 评级
    rating: Real[0..1];
    
    // 下载次数
    downloadCount: Integer = 0;
    
    // 许可证
    license: String[0..1];
}

class TemplateCategory {
    // 模板分类
    attribute id: String[1];
    attribute name: String[1];
    attribute description: Text[0..1];
    
    // 分类层次
    reference parent: TemplateCategory[0..1];
    reference child: TemplateCategory[*];
    
    // 分类模板
    reference template: RegisteredTemplate[*];
}

// 标准模板分类
StandardCategories = [
    "System Architecture",
    "Software Components", 
    "Hardware Design",
    "Control Systems",
    "Communication Systems",
    "Safety Critical Systems",
    "Aerospace Systems",
    "Automotive Systems",
    "Industrial Automation"
]
```

---

## 6. 元模型 Registry

### 6.1 Registry 架构

```sysml
class MetamodelRegistry {
    // 全局 Registry 实例
    static instance: MetamodelRegistry;
    
    // 内置元素注册
    builtinElementRegistry: BuiltinElementRegistry;
    
    // 扩展元素注册
    extensionElementRegistry: ExtensionElementRegistry;
    
    // Profile 注册
    profileRegistry: ProfileRegistry;
    
    // 模板注册
    templateRegistry: TemplateRegistry;
}

class BuiltinElementRegistry {
    // KerML 内置元素
    kermlBuiltin: BuiltinElementDefinition[*];
    
    // SysML v2 内置元素
    sysmlBuiltin: BuiltinElementDefinition[*];
    
    // 注册验证
    registeredValidation: ValidationRule[*];
}

class BuiltinElementDefinition {
    // 元素定义
    reference elementClass: Class[1];
    
    // 元类型
    metaType: MetaTypeKind;
    
    // 命名空间
    namespace: String[1];
    
    // 版本信息
    version: VersionInfo[1];
    
    // 替代名称
    alternativeName: String[*];
}
```

### 6.2 扩展元素注册

```sysml
class ExtensionElementRegistry {
    // 扩展元素注册表
    registeredElement: RegisteredExtensionElement[*];
    
    // 扩展依赖关系
    extensionDependency: ExtensionDependency[*];
}

class RegisteredExtensionElement {
    // 扩展元素定义
    reference elementDefinition: Element[1];
    
    // 扩展元数据
    attribute id: String[1];
    attribute name: String[1];
    attribute description: Text[0..1];
    
    // 扩展版本
    version: VersionInfo[1];
    
    // 注册时间
    registrationTime: DateTime[1];
    
    // 注册者
    registeredBy: String[1];
    
    // 验证状态
    validationStatus: ValidationStatusKind;
    
    // 扩展点
    extensionPoint: ExtensionPoint[0..1];
    
    // 生命周期状态
    lifecycleState: LifecycleStateKind;
}

class ExtensionDependency {
    // 扩展依赖
    reference source: RegisteredExtensionElement[1];
    reference target: RegisteredExtensionElement[1];
    
    dependencyKind: DependencyKind;
}

enum DependencyKind {
    requires,
    conflicts,
    replaces,
    extends
}

class ExtensionPoint {
    // 扩展点定义
    attribute pointId: String[1];
    attribute pointName: String[1];
    
    // 允许的扩展类型
    allowedExtensionType: Class[*];
}
```

### 6.3 元素版本管理

```sysml
class ElementVersionManagement {
    // 版本历史
    versionHistory: VersionHistory[1];
    
    // 版本分支
    versionBranch: VersionBranch[*];
    
    // 版本合并
    versionMerge: VersionMerge[*];
}

class VersionHistory {
    // 版本历史记录
    attribute elementId: String[1];
    versionEntry: VersionEntry[*];
}

class VersionEntry {
    // 版本条目
    attribute version: String[1];
    attribute timestamp: DateTime[1];
    attribute author: String[1];
    attribute comment: String[0..1];
    
    // 版本变更
    change: VersionChange[0..1];
    
    // 版本状态
    state: VersionStateKind;
}

enum VersionStateKind {
    draft,
    review,
    approved,
    released,
    deprecated,
    withdrawn
}

class VersionChange {
    // 版本变更定义
    changeType: ChangeTypeKind;
    affectedElement: Element[*];
    
    // 变更描述
    description: Text[1];
    
    // 影响分析
    impactAnalysis: ImpactAnalysis[0..1];
}

enum ChangeTypeKind {
    add,
    remove,
    modify,
    refactor
}

class ImpactAnalysis {
    // 影响分析
    impactedElement: Element[*];
    impactSeverity: ImpactSeverityKind;
    backwardCompatible: Boolean;
}
```

### 6.4 Registry API

```sysml
interface MetamodelRegistryAPI {
    // 注册操作
    operation register(element: Element[1]): RegistrationResult;
    operation unregister(elementId: String[1]): Boolean;
    
    // 查询操作
    operation lookup(elementId: String[1]): Element[0..1];
    operation query(filter: QueryFilter[1]): Element[*];
    operation findByName(name: String[1]): Element[*];
    operation findByStereotype(stereotype: Stereotype[1]): Element[*];
    
    // 版本操作
    operation getVersion(elementId: String[1]): VersionInfo;
    operation getVersionHistory(elementId: String[1]): VersionHistory;
    operation compareVersions(v1: String[1], v2: String[1]): VersionDiff;
    
    // 验证操作
    operation validate(element: Element[1]): ValidationResult[*];
    operation validateRegistry(): RegistryValidationResult;
    
    // Profile 操作
    operation registerProfile(profile: Profile[1]): RegistrationResult;
    operation applyProfile(element: Element[1], profile: Profile[1]): Boolean;
    operation getAppliedProfiles(element: Element[1]): Profile[*];
}
```

---

## 7. DSM (Domain-Specific Modeling) 支持

### 7.1 DSL 定义

```sysml
class DomainSpecificLanguage {
    // DSL 定义
    attribute id: String[1];
    attribute name: String[1];
    attribute description: Text[0..1];
    
    // DSL 版本
    version: VersionInfo[1];
    
    // 目标域
    targetDomain: String[1];
    
    // 抽象语法
    abstractSyntax: AbstractSyntax[1];
    
    // 具体语法
    concreteSyntax: ConcreteSyntax[*];
    
    // 语义绑定
    semanticBinding: SemanticBinding[0..1];
    
    // 验证规则
    validationRule: DSLValidationRule[*];
}

class AbstractSyntax {
    // 抽象语法定义
    reference metamodel: Package[1];
    
    // 概念映射
    conceptMapping: ConceptMapping[*];
    
    // 关系映射
    relationMapping: RelationMapping[*];
}

class ConceptMapping {
    // 概念定义
    attribute conceptName: String[1];
    reference mappedElement: Element[1];
    mappingConstraint: Constraint[*];
}

class RelationMapping {
    // 关系映射
    attribute relationName: String[1];
    reference sourceConcept: ConceptMapping[1];
    reference targetConcept: ConceptMapping[1];
    relationConstraint: Constraint[*];
}
```

### 7.2 语法绑定

```sysml
class ConcreteSyntax {
    // 具体语法定义
    attribute id: String[1];
    attribute syntaxKind: SyntaxKind[1];
    
    // 符号定义
    symbolDefinition: SymbolDefinition[*];
    
    // 语法规则
    syntaxRule: SyntaxRule[*];
    
    // 格式化规则
    formattingRule: FormattingRule[*];
}

enum SyntaxKind {
    graphical,
    textual,
    tabular,
    tree,
    form
}

class SymbolDefinition {
    // 符号定义
    reference concept: ConceptMapping[1];
    
    // 符号形状
    shape: ShapeDefinition[1];
    
    // 符号样式
    style: StyleDefinition[0..1];
    
    // 默认大小
    defaultSize: Size[0..1];
    
    // 连接点
    connectionPoint: ConnectionPoint[*];
}

class SyntaxRule {
    // 语法规则
    attribute ruleId: String[1];
    attribute ruleName: String[1];
    
    // 规则表达式
    expression: SyntaxExpression[1];
    
    // 优先级
    priority: Integer = 0;
}

class TextualConcreteSyntax extends ConcreteSyntax {
    // 文本具体语法
    attribute syntaxKind = SyntaxKind.textual;
    
    // 关键字定义
    keywordDefinition: KeywordDefinition[*];
    
    // 语法生成器
    syntaxGenerator: SyntaxGenerator[1];
}

class GraphicalConcreteSyntax extends ConcreteSyntax {
    // 图形具体语法
    attribute syntaxKind = SyntaxKind.graphical;
    
    // 图形工具栏
    toolboxDefinition: ToolboxDefinition[1];
    
    // 图形生成器
    diagramGenerator: DiagramGenerator[1];
}
```

### 7.3 验证规则

```sysml
class DSLValidationRule {
    // DSL 验证规则
    attribute ruleId: String[1];
    attribute ruleName: String[1];
    
    // 验证范围
    validationScope: ValidationScope[1];
    
    // 验证条件
    condition: OCLExpression[1];
    
    // 错误消息
    errorMessage: String[1];
    
    // 严重级别
    severity: SeverityKind;
    
    // 快速修复
    quickFix: QuickFix[0..1];
}

class QuickFix {
    // 快速修复定义
    attribute fixId: String[1];
    attribute fixName: String[1];
    
    // 修复动作
    fixAction: FixAction[1];
    
    // 适用条件
    applicabilityCondition: OCLExpression[0..1];
}

class ValidationScope {
    // 验证范围定义
    scopeKind: ScopeKind;
    reference scopeElement: Element[0..1];
}

enum ScopeKind {
    element,
    container,
    package,
    model,
    global
}

// 示例 DSL 验证规则
class AviationDSLValidation extends DSLValidationRule {
    ruleId = "AV-DSL-001";
    ruleName = "BlockMustHaveIdentifier";
    
    validationScope {
        scopeKind = element;
    }
    
    condition = """
        self.oclIsKindOf(Block) implies
        not self.identifier.oclIsUndefined()
    """;
    
    errorMessage = "Block must have a unique identifier";
    severity = error;
}
```

### 7.4 DSM 工作台集成

```sysml
class DSMWorkbench {
    // DSM 工作台定义
    attribute id: String[1];
    attribute name: String[1];
    
    // 关联 DSL
    reference language: DomainSpecificLanguage[1];
    
    // 编辑器定义
    editorDefinition: EditorDefinition[*];
    
    // 工具定义
    toolDefinition: ToolDefinition[*];
    
    // 模板定义
    templateDefinition: DSMTemplate[*];
    
    // 代码生成器
    codeGenerator: CodeGenerator[*];
}

class EditorDefinition {
    // 编辑器定义
    attribute editorId: String[1];
    editorKind: EditorKind;
    
    // 视图定义
    viewDefinition: ViewDefinition[1];
    
    // 交互模式
    interactionMode: InteractionMode[1];
}

class CodeGenerator {
    // 代码生成器
    attribute generatorId: String[1];
    attribute generatorName: String[1];
    
    // 目标语言
    targetLanguage: String[1];
    
    // 生成模板
    generationTemplate: Template[1];
    
    // 生成配置
    generationConfiguration: GenerationConfig[1];
    
    // 执行生成
    operation generate(modelElement: Element[1]): GeneratedArtifact[*];
}

class GeneratedArtifact {
    // 生成产物
    attribute artifactPath: String[1];
    attribute artifactContent: String[1];
    attribute contentType: String[1];
    generatedFrom: Element[1];
    generationTime: DateTime[1];
}
```

---

## 附录 A: 元素继承关系总览

```
KerML Core Layer
├── Element (基类)
│   ├── Relationship
│   │   ├── Feature
│   │   ├── Typing
│   │   └── Ownership
│   ├── Type
│   │   └── Classifier
│   │       ├── Class
│   │       ├── DataType
│   │       └── Behavior
│   └── Annotation
│
SysML v2 Extension Layer
├── Block
│   ├── ValueProperty
│   ├── PartProperty
│   ├── ReferenceProperty
│   └── ConstraintProperty
├── Port
│   ├── FlowPort
│   ├── ProxyPort
│   └── FullPort
├── Interface
├── Requirement
├── Constraint
├── UseCase
├── Actor
├── Allocation
└── Action
    ├── AcceptAction
    ├── SendAction
    ├── CallAction
    └── OpaqueAction

Profile Extension Layer
├── Profile
├── Stereotype
├── Extension
└── ExtensionProperty

Template Layer
├── Template
│   ├── BlockTemplate
│   ├── PatternTemplate
│   └── ViewTemplate
└── TemplateParameter
    ├── TypeTemplateParameter
    ├── ValueTemplateParameter
    └── ConstraintTemplateParameter
```

---

## 附录 B: 关键约束汇总

| 约束 ID | 约束名称 | 约束表达式 | 适用范围 |
|---------|----------|------------|----------|
| KERML-C001 | 无循环所有权 | `not self.oclIsKindOf(Element) or ...` | Element |
| KERML-C002 | 特征有效重定义 | `self.redefinedFeature->forAll(...)` | Feature |
| KERML-C003 | 多重性有效范围 | `multiplicity.lowerBound >= 0` | Multiplicity |
| SYSML-C001 | Block 必须唯一标识 | `self.identifier->notEmpty()` | Block |
| SYSML-C002 | Port 方向有效 | `direction.valid()` | Port |
| SYSML-C003 | Requirement 验证方法 | `verificationMethod->notEmpty()` | Requirement |
| PROFILE-C001 | Stereotype 基类有效 | `baseClass.oclIsKindOf(Classifier)` | Stereotype |
| TEMPLATE-C001 | 参数绑定完整 | `binding->size() = template.parameter->size()` | TemplateInstantiation |

---

## 附录 C: 参考规范

- **OMG SysML v2**: ptc/25-04-32 (正式发布版, 2025年9月)
- **KerML**: OMG Formal/2024-12-01
- **OCL**: OMG formal/2024-04-01
- **UML**: OMG formal/2017-12-05
- **Eclipse SysON**: SysML v2 参考实现
- **ISO/IEC 11179**: 元数据注册标准

---

*文档结束*
