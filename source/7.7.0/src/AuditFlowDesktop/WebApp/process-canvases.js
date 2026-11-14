(() => {
  "use strict";
  const model = window.AuditFlowProcessModel || {};
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const gp = {
    "GP2.1.1":"Identify objectives and define a strategy for process performance",
    "GP2.1.2":"Plan the performance of the process",
    "GP2.1.3":"Determine resource needs",
    "GP2.1.4":"Identify and make available resources",
    "GP2.1.5":"Monitor and adjust the performance of the process",
    "GP2.1.6":"Manage the interfaces between involved parties",
    "GP2.2.1":"Define the requirements for the work products",
    "GP2.2.2":"Define requirements for documentation and control of work products",
    "GP2.2.3":"Identify, document and control the work products",
    "GP2.2.4":"Review and adjust work products",
    "GP3.1.1":"Establish and maintain the standard process",
    "GP3.1.2":"Determine the required competencies",
    "GP3.1.3":"Determine the required resources",
    "GP3.1.4":"Determine suitable methods to monitor the standard process",
    "GP3.2.1":"Deploy a defined process that satisfies the specific context",
    "GP3.2.2":"Ensure required competencies for the defined roles",
    "GP3.2.3":"Ensure required resources to support the defined process",
    "GP3.2.4":"Monitor the performance of the defined process"
  };
  const zhPractices = {
    "ACQ.4": ["约定并维护联合活动、接口和交换信息","交换约定的信息","与供应商评审开发工作产品","评审供应商进展","采取措施纠正偏差"],
    "SPL.2": ["定义发布的功能内容","定义发布包","确保发布的唯一标识","从受配置控制的项构建发布","确保交付前批准发布","提供发布说明","沟通发布支持的类型、服务等级和期限","向预期客户交付发布包"],
    "SYS.1": ["获取利益相关方期望和请求","就需求达成一致","分析利益相关方需求变更","沟通需求状态"],
    "SYS.2": ["定义系统需求","结构化系统需求","分析系统需求","分析对系统上下文的影响","确保一致性并建立双向可追溯性","沟通约定的系统需求及上下文影响"],
    "SYS.3": ["定义系统架构的静态方面","定义系统架构的动态方面","分析系统架构","确保一致性并建立双向可追溯性","沟通约定的系统架构"],
    "SYS.4": ["定义系统集成验证措施","选择验证措施","集成系统元素并执行集成验证","确保一致性并建立双向可追溯性","汇总并沟通结果"],
    "SYS.5": ["定义系统验证措施","选择验证措施","执行集成系统验证","确保一致性并建立双向可追溯性","汇总并沟通结果"],
    "SWE.1": ["定义软件需求","结构化软件需求","分析软件需求","分析对运行环境的影响","确保一致性并建立双向可追溯性","沟通约定的软件需求及运行环境影响"],
    "SWE.2": ["定义软件架构的静态方面","定义软件架构的动态方面","分析软件架构","确保一致性并建立双向可追溯性","沟通约定的软件架构"],
    "SWE.3": ["定义详细设计的静态方面","定义详细设计的动态方面","开发软件单元","确保一致性并建立双向可追溯性","沟通约定的详细设计和已开发单元"],
    "SWE.4": ["定义软件单元验证措施","选择软件单元验证措施","验证软件单元","确保一致性并建立双向可追溯性","汇总并沟通结果"],
    "SWE.5": ["定义软件集成验证措施","定义软件组件行为验证措施","选择验证措施","集成软件元素并执行集成验证","执行软件组件验证","确保一致性并建立双向可追溯性","汇总并沟通结果"],
    "SWE.6": ["定义软件验证措施","选择验证措施","验证集成软件","确保一致性并建立双向可追溯性","汇总并沟通结果"],
    "VAL.1": ["定义产品确认措施","选择确认措施","执行确认并评价结果","确保一致性并建立双向可追溯性","汇总并沟通结果"],
    "MLE.1": ["定义机器学习需求","结构化机器学习需求","分析机器学习需求","分析对机器学习运行环境的影响","确保一致性并建立双向可追溯性","沟通约定的机器学习需求及环境影响"],
    "MLE.2": ["开发机器学习架构","确定超参数范围和初始值","分析机器学习架构元素","定义机器学习架构元素接口","定义机器学习架构元素资源消耗目标","确保一致性并建立双向可追溯性","沟通约定的机器学习架构"],
    "MLE.3": ["定义机器学习训练与验证方法","创建训练与验证数据集","创建并优化机器学习模型","确保一致性并建立双向可追溯性","汇总并沟通约定的已训练模型"],
    "MLE.4": ["定义机器学习测试方法","创建机器学习测试数据集","测试已训练模型","导出部署模型","测试部署模型","确保一致性并建立双向可追溯性","汇总并沟通结果"],
    "HWE.1": ["定义硬件需求","结构化硬件需求","分析硬件需求","分析对运行环境的影响","确保一致性并建立双向可追溯性","沟通约定的硬件需求及环境影响"],
    "HWE.2": ["定义硬件架构","定义硬件详细设计","定义动态方面","分析硬件架构和详细设计","确保一致性并建立双向可追溯性","沟通约定的硬件架构和详细设计"],
    "HWE.3": ["定义针对硬件设计的验证措施","确保使用合规样件","选择验证措施","验证硬件设计","确保一致性并建立双向可追溯性","汇总并沟通结果"],
    "HWE.4": ["定义针对硬件需求的验证措施","确保使用合规样件","选择验证措施","验证合规硬件样件","确保一致性并建立双向可追溯性","汇总并沟通结果"],
    "SUP.1": ["确保质量保证的独立性","定义质量保证准则","保证工作产品质量","保证过程活动质量","汇总并沟通质量保证活动与结果","确保解决不符合项","升级不符合项"],
    "SUP.8": ["识别配置项","定义配置项属性","建立配置管理","控制修改","建立基线","汇总并沟通配置状态","确保完整性和一致性","验证备份与恢复机制的可用性"],
    "SUP.9": ["识别并记录问题","确定问题原因和影响","授权紧急解决措施","发出警报通知","启动问题解决","跟踪问题直至关闭","报告问题解决活动状态"],
    "SUP.10": ["识别并记录变更请求","分析并评价变更请求","实施前批准变更请求","建立双向可追溯性","确认变更请求的实施","跟踪变更请求直至关闭"],
    "SUP.11": ["建立机器学习数据管理系统","开发机器学习数据质量方法","收集机器学习数据","处理机器学习数据","保证机器学习数据质量","沟通约定的已处理数据"],
    "MAN.3": ["定义工作范围","定义项目生命周期","评价项目可行性","定义并监控工作包","定义并监控项目估算与资源","定义并监控所需技能、知识和经验","定义并监控项目接口与约定承诺","定义并监控项目进度","确保一致性","评审并报告项目进展"],
    "MAN.5": ["识别风险来源","识别潜在不利事件","确定风险","定义风险处理选项","定义并执行风险处理活动","监控风险","采取纠正措施"],
    "MAN.6": ["识别信息需求","定义度量指标","收集并存储度量数据","分析收集的度量数据","沟通分析结果","使用度量支持决策"],
    "PIM.3": ["建立承诺","识别改进措施","建立过程改进目标","确定改进优先级","定义过程改进措施","实施过程改进措施","确认过程改进","沟通改进结果"],
    "REU.2": ["选择复用产品","分析产品复用能力","定义复用限制","确保复用产品合格","提供复用产品","沟通复用活动有效性信息"]
  };
  const zhProcesses = {
    "ACQ.4":["供应商监控","依据约定承诺，跟踪并评价外部合同供应商的绩效。","执行客户与供应商约定的联合活动。|按约定定期交换信息。|依据协议监控供应商绩效。|必要时协商协议变更并记录在协议中。"],
    "SPL.2":["产品发布","控制向预期客户进行的产品发布。","确定产品发布内容。|从配置项组装发布包。|定义并编制发布文档。|按既定准则批准发布。|向预期客户提供发布包。"],
    "SYS.1":["需求挖掘","在产品或服务生命周期内收集、分析并跟踪利益相关方需求，形成约定的需求集。","建立与利益相关方的持续沟通。|理解期望，定义并约定需求。|分析需求变更以支持风险评估和影响管理。|确保受影响方能够确定需求状态。"],
    "SYS.2":["系统需求分析","建立与利益相关方需求一致、经过结构化和分析的系统需求集。","定义系统需求。|对系统需求进行结构化并确定优先级。|分析系统需求的正确性和技术可行性。|分析系统需求对运行环境的影响。|建立系统需求与利益相关方需求的一致性和双向追溯。|约定系统需求并向所有受影响方沟通。"],
    "SYS.3":["系统架构设计","建立与系统需求一致、包含静态和动态方面且经过分析的系统架构。","设计系统架构，定义元素、行为、接口、关系和交互。|依据准则分析架构并识别特殊特性。|建立架构与系统需求的一致性和双向追溯。|向受影响方沟通约定的架构及特殊特性。"],
    "SYS.4":["系统集成与集成验证","集成系统元素，验证集成元素与系统架构的一致性。","基于系统架构定义含接口和交互的集成验证措施。|依据发布范围集成为完整系统。|依据发布范围及回归准则选择措施。|执行集成验证并记录结果。|建立措施与架构元素的一致性和双向追溯。|建立结果与措施的双向追溯。|汇总并向受影响方沟通集成及验证结果。"],
    "SYS.5":["系统验证","验证系统与系统需求的一致性。","基于系统需求定义验证措施。|依据发布范围及回归准则选择措施。|验证集成系统并记录结果。|建立措施与需求的一致性和双向追溯。|建立结果与措施的双向追溯。|汇总并向受影响方沟通验证结果。"],
    "SWE.1":["软件需求分析","建立与系统需求及系统架构一致、经过结构化和分析的软件需求集。","定义软件需求。|对软件需求进行结构化并确定优先级。|分析正确性和技术可行性。|分析对运行环境的影响。|建立与系统需求的一致性和双向追溯。|建立与系统架构的一致性和双向追溯。|约定软件需求并向受影响方沟通。"],
    "SWE.2":["软件架构设计","建立与软件需求一致、包含静态和动态方面且经过分析的软件架构。","设计包含静态和动态方面的软件架构。|依据既定准则分析架构。|建立架构与软件需求的一致性和双向追溯。|约定软件架构并向受影响方沟通。"],
    "SWE.3":["软件详细设计与单元构建","建立与软件架构一致的静态、动态详细设计，并构建与详细设计一致的软件单元。","定义包含静态和动态方面的详细设计。|依据详细设计构建软件单元。|建立详细设计与架构、源代码与详细设计、详细设计与需求的一致性和双向追溯。|向受影响方沟通源代码和约定的详细设计。"],
    "SWE.4":["软件单元验证","验证软件单元与软件详细设计的一致性。","定义软件单元验证措施。|依据发布范围及回归准则选择措施。|验证软件单元并记录结果。|建立措施与单元的一致性和双向追溯，以及结果与措施的双向追溯。|汇总并向受影响方沟通单元验证结果。"],
    "SWE.5":["软件组件验证与集成验证","验证软件组件与架构的一致性，并集成软件元素，验证其与软件架构和详细设计的一致性。","基于架构和详细设计定义含接口及交互的集成验证措施。|定义软件组件行为及接口的验证措施。|将软件元素集成为完整软件。|依据发布范围及回归准则选择措施。|验证软件组件并记录结果。|验证集成软件元素并记录结果。|建立措施与架构及详细设计的一致性和双向追溯，以及结果与措施的双向追溯。|汇总并向受影响方沟通组件及集成验证结果。"],
    "SWE.6":["软件验证","验证集成软件与软件需求的一致性。","基于软件需求定义验证措施。|依据发布范围及回归准则选择措施。|验证集成软件并记录结果。|建立措施与需求的一致性和双向追溯，以及结果与措施的双向追溯。|汇总并向受影响方沟通软件验证结果。"],
    "VAL.1":["确认","提供证据证明与最终用户直接交互的产品在目标运行环境中满足预期使用。","考虑回归准则选择确认措施。|执行产品确认并记录结果。|建立措施与利益相关方需求的一致性和单向追溯，以及结果与措施的一致性和双向追溯。|汇总并向受影响方沟通确认结果。"],
    "MLE.1":["机器学习需求分析","将与机器学习相关的软件需求细化为机器学习需求集。","基于软件需求及架构组件定义机器学习需求和数据需求。|结构化需求并确定优先级。|分析正确性和可验证性。|分析对机器学习运行环境的影响。|建立与软件需求及架构的一致性和双向追溯。|约定需求并向受影响方沟通。"],
    "MLE.2":["机器学习架构","建立支持训练与部署且与机器学习需求一致的架构，并依据准则评价架构。","开发机器学习架构。|确定超参数范围和初始值以支持训练。|评价架构元素。|定义架构元素接口。|定义资源消耗目标。|建立架构元素与需求的一致性和双向追溯。|约定架构并向受影响方沟通。"],
    "MLE.3":["机器学习训练","优化机器学习模型以满足定义的需求。","定义训练与验证方法。|创建训练和验证数据集。|优化模型及超参数以满足需求。|建立训练与验证数据集和数据需求的一致性与双向追溯。|汇总优化结果，约定已训练模型并向受影响方沟通。"],
    "MLE.4":["机器学习模型测试","确保已训练及已部署模型符合机器学习需求。","定义机器学习测试方法。|创建测试数据集。|测试已训练模型。|从已训练模型导出部署模型并测试。|建立测试方法与需求、数据集与数据需求的一致性和双向追溯，以及测试方法与结果的双向追溯。|汇总测试结果并连同部署模型向受影响方沟通。"],
    "HWE.1":["硬件需求分析","建立与系统需求和系统架构设计一致、经过结构化和分析的硬件需求集。","定义硬件需求。|结构化需求并确定优先级。|分析正确性和技术可行性。|分析对运行环境的影响。|建立与系统需求的一致性和双向追溯。|建立与系统架构设计的一致性和双向追溯。|约定需求并向受影响方沟通。"],
    "HWE.2":["硬件设计","提供与硬件需求一致、适合制造且经分析的动态和静态设计，并导出生产相关数据。","开发架构及详细设计，描述元素、行为、接口和动态交互。|分析架构及详细设计并识别特殊特性。|建立需求与设计的一致性和双向追溯。|从详细设计导出生产数据并沟通。|导出生产测试信息并沟通。|约定架构、详细设计及特殊特性并沟通。"],
    "HWE.3":["硬件设计验证","验证符合生产数据的硬件，提供符合硬件设计的证据。","定义包含接口和动态方面的硬件设计验证措施。|依据发布范围及回归准则选择措施。|在符合生产数据的样件上验证并记录结果。|建立硬件元素与措施的一致性和双向追溯。|建立措施与结果的双向追溯。|汇总并沟通结果。"],
    "HWE.4":["硬件需求验证","验证完整硬件与硬件需求的一致性。","依据硬件需求定义验证措施。|考虑回归准则选择措施。|适用时使用符合生产数据的样件验证并记录结果。|建立措施与需求的一致性和双向追溯。|建立措施与结果的双向追溯。|汇总并沟通结果。"],
    "SUP.1":["质量保证","独立客观地保证工作产品和过程符合既定准则，解决并预防不符合项。","无利益冲突地独立、客观执行质量保证。|定义工作产品及过程实施质量准则。|验证、记录并沟通符合性。|跟踪、解决并预防不符合项。|向适当管理层升级不符合项。|管理层确保解决已升级的不符合项。"],
    "SUP.8":["配置管理","建立并维护配置项及基线的完整性，并向受影响方提供。","定义并应用配置项选择准则。|定义配置项属性。|建立配置管理。|控制修改。|建立基线。|记录并报告配置状态。|确保基线完整性和一致性。|验证备份与恢复机制的可用性。"],
    "SUP.9":["问题解决管理","确保识别、记录和分析问题，并管理及控制问题解决。","唯一标识、记录并分类问题。|分析及评价问题以确定适当方案。|启动问题解决。|跟踪问题直至关闭。|向利益相关方报告问题状态及趋势。"],
    "SUP.10":["变更请求管理","确保记录、分析、跟踪、批准和实施变更请求。","记录并识别变更请求。|分析变更、识别依赖及关联并估算影响。|实施前批准变更并确定优先级。|建立变更与受影响工作产品的双向追溯。|确认变更实施。|跟踪至关闭并向受影响方沟通状态。"],
    "SUP.11":["机器学习数据管理","定义与需求一致的机器学习数据，维护其完整性和质量并向受影响方提供。","建立包含生命周期的数据管理系统。|开发含质量准则的数据质量方法。|处理收集的数据以保持与需求一致。|按质量准则验证数据并按需更新。|约定数据并向受影响方沟通。"],
    "MAN.3":["项目管理","在项目需求与约束下识别和控制开发活动，并建立所需资源。","定义项目工作范围。|评价在现有资源和约束下达成目标的可行性。|估算活动和资源。|识别并监控项目内外接口。|开发、实施和维护项目计划。|监控并报告进展。|未达成目标时进行调整。"],
    "MAN.5":["风险管理","定期识别、分析、处理和监控过程及产品风险。","识别并定期更新风险来源。|识别项目中潜在的不利事件。|分析风险并确定处理资源优先级。|定义、应用和评价风险措施以确定状态变化及处理进展。|依据优先级、概率、后果或阈值纠正或避免风险影响。"],
    "MAN.6":["度量","收集和分析组织及项目的开发结果与过程数据，支持有效过程管理。","识别评价过程目标和工作产品所需的信息需求。|依据需求识别或开发适当度量指标。|识别并执行度量活动。|收集、存储、分析数据并解释结果。|使用度量支持决策和客观沟通。"],
    "PIM.3":["过程改进","通过过程持续提高组织有效性和效率，确保过程符合业务需求。","承诺提供维持改进的资源。|识别内外环境中的改进机会及变更理由。|分析现有过程状态。|识别并排序改进目标，定义、记录和实施变更。|对照目标监控、度量和确认实施效果。|在组织内沟通改进知识。"],
    "REU.2":["复用产品管理","确保对复用工作产品进行分析、验证并批准其在目标上下文中的使用。","依据准则选择复用产品。|分析可移植性和互操作性。|定义并沟通复用限制。|验证复用产品。|向受影响方提供复用产品。|建立与复用产品提供方的沟通机制。"]
  };
  const zhGp = ["识别目标并定义过程实施策略","计划过程的实施","确定资源需求","识别并提供资源","监控和调整过程实施","管理参与方接口","定义工作产品要求","定义工作产品文档与控制要求","识别、记录和控制工作产品","评审并调整工作产品","建立并维护标准过程","确定所需能力","确定所需资源","确定监控标准过程的适当方法","部署满足具体上下文的已定义过程","确保已定义角色所需的能力","确保支持已定义过程的资源","监控已定义过程的绩效"];
  const zhLabels = {
    "Project management":"项目管理","Project Management":"项目管理","V-model design":"V 模型设计","V-model verification":"V 模型验证","Supporting processes":"支持过程","CL2 / CL3 generic practices":"CL2 / CL3 通用实践","Performance Management":"绩效管理","Work Product Management":"工作产品管理","Process Definition and Deployment":"过程定义与部署",
    "Contract and stakeholder requirements":"合同与利益相关方需求","Project management plan":"项目管理计划","Discipline lifecycle":"专业生命周期","Team feasibility":"团队可行性","WBS and schedule":"工作分解结构与进度","Sample / tool list, lifecycle, risk list, action list":"样件与工具清单、生命周期、风险及行动清单","Competency, training, mentoring":"能力、培训与指导","Stakeholders, communication plan, object review list":"利益相关方、沟通计划与对象评审清单","Schedule and action list":"进度与行动清单","Review report and consistency adjustments":"评审报告与一致性调整","Action list, project status and milestone reports":"行动清单、项目状态与里程碑报告","Input":"输入","Scope management":"范围管理","Lifecycle":"生命周期","Feasibility / cost":"可行性与成本","Work packages":"工作包","Resource management":"资源管理","Skills management":"技能管理","Stakeholder management":"利益相关方管理","Schedule management":"进度管理","Consistency":"一致性","Progress review":"进展评审","Work product":"工作产品",
    "SYS.1 Stakeholder requirements":"SYS.1 利益相关方需求","System requirements specification":"系统需求规格","Requirements analysis / review record":"需求分析与评审记录","MAN.5 Risk identification / MAN.3 Feasibility":"MAN.5 风险识别 / MAN.3 可行性","Derive requirements":"导出需求","Specify":"定义","Structure":"结构化","Analyze":"分析","Feasibility and risk":"可行性与风险","Analysis results":"分析结果","Operating environment":"运行环境","Impact analysis":"影响分析","Bidirectional traceability":"双向可追溯性","Agreed requirements":"约定的需求","Communicate":"沟通","SYS.2 System requirements":"SYS.2 系统需求","SYS.3 System architecture":"SYS.3 系统架构","Software requirements specification":"软件需求规格","Analysis and agreement records":"分析与约定记录","Allocate and derive":"分配与导出","Architecture constraints":"架构约束","Structure and prioritize":"结构化并确定优先级","Analyze requirements":"分析需求","Feasibility":"可行性","Impact":"影响","Consistency and traceability":"一致性与追溯","Requirement links":"需求关联","Agree and communicate":"约定与沟通",
    "System architecture":"系统架构","Architecture analysis and rationale":"架构分析与决策理由","MAN.5 Risk / MAN.3 Feasibility":"MAN.5 风险 / MAN.3 可行性","Agreement and communication records":"约定与沟通记录","Requirements input":"需求输入","Behavior constraints":"行为约束","Static architecture":"静态架构","Dynamic behavior":"动态行为","Analyze architecture":"分析架构","Risk and feasibility":"风险与可行性","Design rationale":"设计理由","Architecture links":"架构关联","Agreed architecture":"约定的架构","SWE.1 Software requirements":"SWE.1 软件需求","Software architectural design":"软件架构设计","MAN.5 / MAN.3 Risk and feasibility":"MAN.5 / MAN.3 风险与可行性","Architecture agreement records":"架构约定记录","Requirements":"需求","Dynamic architecture":"动态架构","Analyze design alternatives":"分析设计备选方案","Risk / feasibility":"风险与可行性","Evaluation":"评价","Requirements traceability":"需求追溯","SWE.1 Requirements":"SWE.1 需求","SWE.2 Architecture":"SWE.2 架构","Software detailed design":"软件详细设计","Software units and source code":"软件单元与源代码","Agreed detailed design":"约定的详细设计","Architecture input":"架构输入","Static detailed design":"静态详细设计","Construct units":"构建单元","Implemented software":"已实现的软件","Requirements consistency":"需求一致性","Architecture traceability":"架构追溯","Design to code":"设计到代码","Communication record":"沟通记录",
    "SWE.3 Detailed design and units":"SWE.3 详细设计与单元","Unit verification specification":"单元验证规格","Selected verification measures":"选定的验证措施","Unit verification results":"单元验证结果","Release scope / verification strategy":"发布范围与验证策略","Derive measures":"导出措施","Define verification measures":"定义验证措施","Select measures":"选择措施","Selection criteria":"选择准则","Coverage and regression":"覆盖与回归","Execute unit verification":"执行单元验证","Results":"结果","Summarize and communicate":"汇总并沟通","Traceability":"可追溯性","Coverage":"覆盖","SWE.3 Detailed design / units":"SWE.3 详细设计与单元","Integration and component verification measures":"集成与组件验证措施","Integrated software / results":"集成软件与结果","Component verification results":"组件验证结果","MAN.3 Schedule / SPL.2 Release scope":"MAN.3 进度 / SPL.2 发布范围","Architecture / interfaces":"架构与接口","Component design":"组件设计","Integration measures":"集成措施","Component measures":"组件措施","Select verification measures":"选择验证措施","Release and regression scope":"发布与回归范围","Integration sequence":"集成顺序","Integrate and verify":"集成与验证","Component verification":"组件验证","Summarize":"汇总","Consistency / traceability":"一致性与追溯","Design links":"设计关联","Results links":"结果关联","System integration verification specification":"系统集成验证规格","System elements":"系统元素","Integrated system and verification results":"集成系统与验证结果","Architecture and interfaces":"架构与接口","Release scope":"发布范围","Selected measures":"选定措施","Integrate elements":"集成元素","Execute and record":"执行与记录","Summarize / communicate":"汇总与沟通","Software verification measures":"软件验证措施","Integrated software":"集成软件","Verification results and coverage":"验证结果与覆盖","Release scope and regression criteria":"发布范围与回归准则","Derive verification measures":"导出验证措施","Specify measures":"定义措施","Release scope / regression":"发布范围与回归","Verification object":"验证对象","Execute verification":"执行验证","System verification measures":"系统验证措施","Integrated system":"集成系统",
    "Quality assurance plan / criteria":"质量保证计划与准则","Work products":"工作产品","Processes":"过程","Quality assurance results and nonconformances":"质量保证结果与不符合项","SUP.9 Problem resolution management":"SUP.9 问题解决管理","Independence and objectivity":"独立性与客观性","Criteria":"准则","Work-product assurance":"工作产品保证","Process assurance":"过程保证","Verify conformance":"验证符合性","Quality results":"质量结果","Resolve nonconformances":"解决不符合项","Escalation criteria":"升级准则","Track actions":"跟踪措施","Unresolved deviation":"未解决偏差","SPL.2 Unique release identification and delivery":"SPL.2 发布唯一标识与交付","Configuration management system":"配置管理系统","Configuration status reports":"配置状态报告","Backup and recovery records":"备份与恢复记录","Configuration management strategy":"配置管理策略","MAN.3 Project progress review":"MAN.3 项目进展评审","Define strategy":"定义策略","Configuration items":"配置项","Properties / controls":"属性与控制","Establish system":"建立系统","Control modifications":"控制修改","Establish baselines":"建立基线","Release baseline":"发布基线","Configuration status":"配置状态","Report":"报告","Progress":"进展","Verify completeness / consistency":"验证完整性与一致性","Ensure backup availability":"确保备份可用","Recovery evidence":"恢复证据","Problem resolution strategy":"问题解决策略","Problem report / problem management system":"问题报告与问题管理系统","Corrective action and resolution record":"纠正措施与解决记录","SUP.10 Change request management":"SUP.10 变更请求管理","Problem status and trend analysis":"问题状态与趋势分析","Identification / classification":"识别与分类","Record problem":"记录问题","Cause and impact analysis":"原因与影响分析","Urgent action needed":"需要紧急措施","Affected parties":"受影响方","Containment":"遏制措施","Agree resolution":"约定解决方案","Initiate resolution":"启动解决","Change required":"需要变更","Implementation status":"实施状态","Closure criteria":"关闭准则","Track to closure":"跟踪直至关闭","Analyze trends":"分析趋势",
    "Change request / problem management system":"变更请求与问题管理系统","SUP.9 Problem resolution":"SUP.9 问题解决","Change request list and approval records":"变更清单与批准记录","Affected work products / PA 1.1":"受影响工作产品 / PA 1.1","Implementation and confirmation records":"实施与确认记录","Identify change":"识别变更","According to strategy":"依据策略","Analyze impact / dependencies":"分析影响与依赖","Decision inputs":"决策输入","Approve before implementation":"实施前批准","Approved request":"已批准请求","Confirmation criteria":"确认准则","Establish traceability":"建立追溯","Originating problem":"源问题","Affected work products":"受影响工作产品","Dependencies":"依赖关系","Confirm implementation":"确认实施","Supplier agreement":"供应商协议","Supplier review / information exchange records":"供应商评审与信息交换记录","Supplier progress and deviation records":"供应商进展与偏差记录","SYS.1 / MAN.3 / SUP.10 Interfaces":"SYS.1 / MAN.3 / SUP.10 接口","Agree joint activities":"约定联合活动","Exchange information":"交换信息","Review work products":"评审工作产品","Review progress":"评审进展","Consistent interfaces":"一致的接口","Information exchange":"信息交换","Review results":"评审结果","Performance and commitments":"绩效与承诺","Deviation identified":"已识别偏差","Corrective action and closure":"纠正措施与关闭",
    "Process performance plan":"过程实施计划","People, tools, infrastructure and information":"人员、工具、基础设施和信息","MAN.3 Work packages, resources, skills, schedule and interfaces":"MAN.3 工作包、资源、技能、进度和接口","Objectives and strategy":"目标与策略","Activities and schedule":"活动与进度","Monitor planned performance":"监控计划实施","Adjust on deviation":"偏差调整","Resource requirements":"资源需求","Make resources available":"提供资源","Resource availability":"资源可用性","Monitor resources":"监控资源","Interfaces and commitments":"接口与承诺","Project planning context":"项目策划上下文","SUP.1.BP2 Quality criteria":"SUP.1.BP2 质量准则","SUP.1.BP3 Work product quality":"SUP.1.BP3 工作产品质量","SUP.8.BP2 Properties":"SUP.8.BP2 属性","SUP.8 Modification and baseline control":"SUP.8 修改与基线控制","Process work products":"过程工作产品","Review records and resolved issues":"评审记录与已解决问题","Identification, versions, storage and access":"标识、版本、存储与访问","Quality criteria":"质量准则","Define requirements":"定义要求","Review and adjust":"评审与调整","Quality assurance":"质量保证","Results / adjustments":"结果与调整","Documentation and control requirements":"文档与控制要求","Configuration properties":"配置属性","Change and baseline control":"变更与基线控制","Document and control":"记录与控制","Controlled work products":"受控工作产品","Organization standard process":"组织标准过程","Project defined process and tailoring":"项目已定义过程与裁剪","Establish and maintain":"建立与维护","Based on standard process":"基于标准过程","Specific context / tailoring":"具体上下文与裁剪","Determine roles and competencies":"确定角色与能力","Determine resources":"确定资源","Monitor effectiveness":"监控有效性","Based on standard competencies":"基于标准能力","Based on standard resources":"基于标准资源","Based on monitoring methods":"基于监控方法"
  };
  const locale = settings => typeof settings === "string" ? settings : settings?.language || document.documentElement?.lang || "en";
  const text = (settings, zh, en) => locale(settings) === "en" ? en : zh;
  const label = (value, settings) => locale(settings) === "en" ? value : zhLabels[value] || value;
  function describe(id, settings) {
    const item = model[id], zh = zhProcesses[id];
    if (!item) return { name: label(graphs[id]?.name || id, settings), purpose: "", outcomes: [], practices: [] };
    if (locale(settings) === "en") return item;
    return { ...item, name: zh?.[0] || item.name, purpose: zh?.[1] || item.purpose, outcomes: zh?.[2]?.split("|") || item.outcomes, practices: item.practices.map((practice, i) => ({ ...practice, title: zhPractices[id]?.[i] || practice.title, description: zhPractices[id]?.[i] || practice.description })) };
  }
  function displayNode(id, n, settings) {
    if (locale(settings) === "en") return n;
    const code = n.id.replace(/\s/g, ""), title = code.startsWith("GP") ? zhGp[Object.keys(gp).indexOf(code)] : code.startsWith("BP") ? zhPractices[id]?.[Number(code.slice(2)) - 1] : label(n.title, settings);
    return { ...n, title: title || n.title, detail: title || label(n.detail, settings) };
  }
  const graphs = {};
  const node = (id, title, x, y, kind = "artifact", detail = "") => ({id,title,x,y,kind,detail,w:190,h:76});
  function define(id, page, group, positions, artifacts, edges) {
    const practices = model[id]?.practices || [];
    const nodes = positions.map(([code,x,y]) => {
      const practice = practices.find(item => item.code.replace(/\s/g, "") === code);
      return node(code, gp[code] || practice?.title || code, x,y,code.startsWith("GP") ? "gp" : "bp", practice?.description || gp[code]);
    }).concat(artifacts.map(item => node(...item)));
    graphs[id] = {id,page,group,name:model[id]?.name || ({"PA 2.1":"Performance Management","PA 2.2":"Work Product Management","PA 3.1 / 3.2":"Process Definition and Deployment"}[id]),nodes,edges:edges.map(([from,to,label])=>({from,to,label}))};
  }
  define("MAN.3",14,"Project management",
    [["BP1",150,90],["BP2",150,250],["BP3",150,410],["BP4",150,570],["BP5",580,90],["BP6",580,570],["BP7",1010,90],["BP8",1010,250],["BP9",1010,410],["BP10",1010,570]],
    [["INPUT","Contract and stakeholder requirements",0,320,"input"],["PMP","Project Management",580,330,"hub"],["A1","Project management plan",150,5],["A2","Discipline lifecycle",150,172],["A3","Team feasibility",150,492],["A4","WBS and schedule",150,654],["A5","Sample / tool list, lifecycle, risk list, action list",580,5],["A6","Competency, training, mentoring",580,654],["A7","Stakeholders, communication plan, object review list",1010,5],["A8","Schedule and action list",1010,172],["A9","Review report and consistency adjustments",1010,492],["A10","Action list, project status and milestone reports",1010,654]],
    [["INPUT","BP1","Input"],["BP1","PMP","Scope management"],["BP2","PMP","Lifecycle"],["BP3","PMP","Feasibility / cost"],["BP4","PMP","Work packages"],["BP5","PMP","Resource management"],["BP6","PMP","Skills management"],["BP7","PMP","Stakeholder management"],["BP8","PMP","Schedule management"],["BP9","PMP","Consistency"],["BP10","PMP","Progress review"],...[1,2,3,4,5,6,7,8,9,10].map(i=>["BP"+i,"A"+i,"Work product"])]);
  define("SYS.2",19,"V-model design",
    [["BP1",400,470],["BP2",130,70],["BP3",130,280],["BP4",590,70],["BP5",900,470],["BP6",1010,100]],
    [["SYS.1","SYS.1 Stakeholder requirements",60,560,"related"],["REQ","System requirements specification",440,270],["ANA","Requirements analysis / review record",740,290],["RISK","MAN.5 Risk identification / MAN.3 Feasibility",10,400,"related"]],
    [["SYS.1","BP1","Derive requirements"],["BP1","REQ","Specify"],["REQ","BP2","Structure"],["REQ","BP3","Analyze"],["BP3","RISK","Feasibility and risk"],["BP3","ANA","Analysis results"],["REQ","BP4","Operating environment"],["BP4","ANA","Impact analysis"],["BP1","BP5","Consistency"],["SYS.1","BP5","Bidirectional traceability"],["ANA","BP6","Agreed requirements"],["REQ","BP6","Communicate"]]);
  define("SWE.1",21,"V-model design",
    [["BP1",590,300],["BP2",120,70],["BP3",120,300],["BP4",590,70],["BP5",300,560],["BP6",1010,210]],
    [["SYS.2","SYS.2 System requirements",50,450,"related"],["SYS.3","SYS.3 System architecture",600,560,"related"],["REQ","Software requirements specification",360,300],["ANA","Analysis and agreement records",840,70]],
    [["SYS.2","BP1","Allocate and derive"],["SYS.3","BP1","Architecture constraints"],["BP1","REQ","Specify"],["REQ","BP2","Structure and prioritize"],["REQ","BP3","Analyze requirements"],["REQ","BP4","Operating environment"],["BP3","ANA","Feasibility"],["BP4","ANA","Impact"],["SYS.2","BP5","Consistency and traceability"],["SYS.3","BP5","Consistency and traceability"],["REQ","BP5","Requirement links"],["ANA","BP6","Agree and communicate"]]);
  define("SYS.3",25,"V-model design",
    [["BP1",180,190],["BP2",180,380],["BP3",770,110],["BP4",440,560],["BP5",1010,380]],
    [["SYS.2","SYS.2 System requirements",10,560,"related"],["ARCH","System architecture",470,270],["ANA","Architecture analysis and rationale",780,270],["RISK","MAN.5 Risk / MAN.3 Feasibility",760,0,"related"],["AGREE","Agreement and communication records",1010,540]],
    [["SYS.2","BP1","Requirements input"],["SYS.2","BP2","Behavior constraints"],["BP1","ARCH","Static architecture"],["BP2","ARCH","Dynamic behavior"],["ARCH","BP3","Analyze architecture"],["RISK","BP3","Risk and feasibility"],["BP3","ANA","Design rationale"],["ARCH","BP4","Architecture links"],["SYS.2","BP4","Bidirectional traceability"],["ANA","BP5","Agreed architecture"],["BP5","AGREE","Communicate"]]);
  define("SWE.2",27,"V-model design",
    [["BP1",120,300],["BP2",120,80],["BP3",850,100],["BP4",300,550],["BP5",1010,420]],
    [["SWE.1","SWE.1 Software requirements",0,550,"related"],["ARCH","Software architectural design",480,200],["ANA","Architecture analysis and rationale",770,300],["RISK","MAN.5 / MAN.3 Risk and feasibility",580,30,"related"],["AGREE","Architecture agreement records",780,580]],
    [["SWE.1","BP1","Requirements"],["SWE.1","BP2","Behavior constraints"],["BP1","ARCH","Static architecture"],["BP2","ARCH","Dynamic architecture"],["ARCH","BP3","Analyze design alternatives"],["RISK","BP3","Risk / feasibility"],["BP3","ANA","Evaluation"],["SWE.1","BP4","Requirements traceability"],["ARCH","BP4","Consistency"],["ANA","BP5","Agreed architecture"],["BP5","AGREE","Communicate"]]);
  define("SWE.3",31,"V-model design",
    [["BP1",120,150],["BP2",120,370],["BP3",790,310],["BP4",400,580],["BP5",1010,80]],
    [["SWE.1","SWE.1 Requirements",0,580,"related"],["SWE.2","SWE.2 Architecture",390,20,"related"],["DESIGN","Software detailed design",430,300],["UNITS","Software units and source code",1010,490],["AGREE","Agreed detailed design",750,80]],
    [["SWE.2","BP1","Architecture input"],["BP1","DESIGN","Static detailed design"],["BP2","DESIGN","Dynamic behavior"],["DESIGN","BP3","Construct units"],["BP3","UNITS","Implemented software"],["SWE.1","BP4","Requirements consistency"],["SWE.2","BP4","Architecture traceability"],["UNITS","BP4","Design to code"],["DESIGN","BP5","Agree and communicate"],["BP5","AGREE","Communication record"]]);
  define("SWE.4",38,"V-model verification",
    [["BP1",940,160],["BP2",180,310],["BP3",780,30],["BP4",670,580],["BP5",180,30]],
    [["SWE.3","SWE.3 Detailed design and units",10,570,"related"],["SPEC","Unit verification specification",570,240],["SET","Selected verification measures",200,450],["RESULT","Unit verification results",480,30],["RELEASE","Release scope / verification strategy",980,470]],
    [["SWE.3","BP1","Derive measures"],["BP1","SPEC","Define verification measures"],["SPEC","BP2","Select measures"],["RELEASE","BP2","Selection criteria"],["BP2","SET","Coverage and regression"],["SET","BP3","Execute unit verification"],["BP3","RESULT","Results"],["RESULT","BP5","Summarize and communicate"],["SWE.3","BP4","Traceability"],["SPEC","BP4","Coverage"],["RESULT","BP4","Consistency"]]);
  define("SWE.5",41,"V-model verification",
    [["BP1",430,30],["BP2",770,30],["BP3",540,360],["BP4",90,190],["BP5",540,560],["BP6",1010,560],["BP7",30,570]],
    [["SWE.2","SWE.2 Architecture",10,10,"related"],["SWE.3","SWE.3 Detailed design / units",990,170,"related"],["SPEC","Integration and component verification measures",540,180],["INTEGRATED","Integrated software / results",50,370],["RESULT","Component verification results",780,560],["PLAN","MAN.3 Schedule / SPL.2 Release scope",1010,370,"related"]],
    [["SWE.2","BP1","Architecture / interfaces"],["SWE.3","BP2","Component design"],["BP1","SPEC","Integration measures"],["BP2","SPEC","Component measures"],["SPEC","BP3","Select verification measures"],["PLAN","BP3","Release and regression scope"],["BP3","BP4","Integration sequence"],["BP4","INTEGRATED","Integrate and verify"],["BP3","BP5","Component verification"],["BP5","RESULT","Results"],["INTEGRATED","BP7","Summarize"],["RESULT","BP7","Communicate"],["SWE.2","BP6","Consistency / traceability"],["SWE.3","BP6","Design links"],["RESULT","BP6","Results links"]]);
  define("SYS.4",45,"V-model verification",
    [["BP1",540,40],["BP2",540,300],["BP3",540,560],["BP4",1010,520],["BP5",40,520]],
    [["SYS.3","SYS.3 System architecture",20,40,"related"],["SPEC","System integration verification specification",540,170],["ELEMENTS","System elements",20,260,"input"],["RESULT","Integrated system and verification results",280,410],["PLAN","MAN.3 Schedule / SPL.2 Release scope",1010,260,"related"]],
    [["SYS.3","BP1","Architecture and interfaces"],["BP1","SPEC","Define verification measures"],["SPEC","BP2","Select measures"],["PLAN","BP2","Release scope"],["BP2","BP3","Selected measures"],["ELEMENTS","BP3","Integrate elements"],["BP3","RESULT","Execute and record"],["RESULT","BP5","Summarize / communicate"],["SYS.3","BP4","Architecture traceability"],["SPEC","BP4","Coverage"],["RESULT","BP4","Consistency"]]);
  function verificationGraph(id,page,upstream,product) {
    const system=id==="SYS.5";
    define(id,page,"V-model verification",
      [["BP1",system?560:700,30],["BP2",160,230],["BP3",160,470],["BP4",1010,520],["BP5",530,620]],
      [[upstream,`${upstream} ${system?"System":"Software"} requirements`,10,20,"related"],["SPEC",`${system?"System":"Software"} verification measures`,system?560:700,220],["PRODUCT",product,10,620,"input"],["RESULT","Verification results and coverage",600,460],["PLAN","Release scope and regression criteria",1010,230]],
      [[upstream,"BP1","Derive verification measures"],["BP1","SPEC","Specify measures"],["SPEC","BP2","Select measures"],["PLAN","BP2","Release scope / regression"],["BP2","BP3","Selected measures"],["PRODUCT","BP3","Verification object"],["BP3","RESULT","Execute verification"],["RESULT","BP5","Summarize and communicate"],[upstream,"BP4","Requirements traceability"],["SPEC","BP4","Coverage"],["RESULT","BP4","Consistency"]]);
  }
  verificationGraph("SWE.6",47,"SWE.1","Integrated software");
  verificationGraph("SYS.5",49,"SYS.2","Integrated system");
  define("SUP.1",56,"Supporting processes",
    [["BP1",330,30],["BP2",740,30],["BP3",150,270],["BP4",950,270],["BP5",550,350],["BP6",150,570],["BP7",950,570]],
    [["QA","Quality assurance plan / criteria",550,180],["WP","Work products",10,110,"input"],["PROC","Processes",1010,110,"input"],["NC","Quality assurance results and nonconformances",550,490],["SUP.9","SUP.9 Problem resolution management",550,650,"related"]],
    [["BP1","QA","Independence and objectivity"],["BP2","QA","Criteria"],["QA","BP3","Work-product assurance"],["QA","BP4","Process assurance"],["WP","BP3","Verify conformance"],["PROC","BP4","Verify conformance"],["BP3","BP5","Quality results"],["BP4","BP5","Quality results"],["BP5","NC","Summarize and communicate"],["NC","BP6","Resolve nonconformances"],["NC","BP7","Escalation criteria"],["BP6","SUP.9","Track actions"],["BP7","SUP.9","Unresolved deviation"]]);
  define("SUP.8",59,"Supporting processes",
    [["BP1",350,190],["BP2",610,190],["BP3",460,400],["BP4",460,30],["BP5",460,620],["BP6",1000,190],["BP7",1000,400],["BP8",1000,620],["GP2.1.1",10,190]],
    [["SPL.2","SPL.2 Unique release identification and delivery",10,480,"related"],["CM","Configuration management system",460,510],["STATUS","Configuration status reports",740,400],["BACKUP","Backup and recovery records",740,650],["STRATEGY","Configuration management strategy",10,30],["MAN.3","MAN.3 Project progress review",1000,30,"related"]],
    [["GP2.1.1","STRATEGY","Define strategy"],["STRATEGY","BP1","Selection criteria"],["BP1","BP2","Configuration items"],["BP2","BP3","Properties / controls"],["BP3","CM","Establish system"],["BP4","CM","Control modifications"],["CM","BP5","Establish baselines"],["SPL.2","BP5","Release baseline"],["CM","BP6","Configuration status"],["BP6","STATUS","Report"],["STATUS","MAN.3","Progress"],["CM","BP7","Verify completeness / consistency"],["CM","BP8","Ensure backup availability"],["BP8","BACKUP","Recovery evidence"]]);
  define("SUP.9",62,"Supporting processes",
    [["GP2.1.1",20,20],["BP1",940,30],["BP2",940,230],["BP3",120,210],["BP4",120,380],["BP5",120,550],["BP6",940,560],["BP7",480,650]],
    [["STRATEGY","Problem resolution strategy",410,30],["PROBLEM","Problem report / problem management system",640,210],["ACTION","Corrective action and resolution record",480,410],["SUP.10","SUP.10 Change request management",480,550,"related"],["STATUS","Problem status and trend analysis",740,650]],
    [["GP2.1.1","STRATEGY","Define strategy"],["STRATEGY","BP1","Identification / classification"],["BP1","PROBLEM","Record problem"],["PROBLEM","BP2","Cause and impact analysis"],["BP2","BP3","Urgent action needed"],["BP2","BP4","Affected parties"],["BP3","ACTION","Containment"],["BP4","ACTION","Communicate"] ,["BP2","BP5","Agree resolution"],["BP5","ACTION","Initiate resolution"],["ACTION","SUP.10","Change required"],["SUP.10","BP6","Implementation status"],["ACTION","BP6","Closure criteria"],["BP6","STATUS","Track to closure"],["STATUS","BP7","Analyze trends"]]);
  define("SUP.10",64,"Supporting processes",
    [["GP2.1.1",40,160],["BP1",440,230],["BP2",960,230],["BP3",960,420],["BP4",440,20],["BP5",960,610],["BP6",440,610]],
    [["INPUT","Change request / problem management system",10,400,"input"],["SUP.9","SUP.9 Problem resolution",80,20,"related"],["CR","Change request list and approval records",680,410],["WP","Affected work products / PA 1.1",970,20,"related"],["CONFIRM","Implementation and confirmation records",700,610]],
    [["INPUT","BP1","Identify change"],["GP2.1.1","BP1","According to strategy"],["BP1","BP2","Analyze impact / dependencies"],["BP2","BP3","Decision inputs"],["BP3","CR","Approve before implementation"],["CR","BP5","Approved request"],["BP5","CONFIRM","Confirmation criteria"],["CONFIRM","BP6","Track to closure"],["BP1","BP4","Establish traceability"],["SUP.9","BP4","Originating problem"],["BP4","WP","Affected work products"],["WP","BP2","Dependencies"],["WP","BP5","Confirm implementation"]]);
  define("ACQ.4",67,"Supporting processes",
    [["BP1",130,40],["BP2",530,250],["BP3",130,350],["BP4",970,350],["BP5",530,570]],
    [["AGREE","Supplier agreement",430,30],["RECORD","Supplier review / information exchange records",130,550],["STATUS","Supplier progress and deviation records",970,550],["RELATED","SYS.1 / MAN.3 / SUP.10 Interfaces",970,40,"related"],["SUP.9","SUP.9 Problem resolution",820,680,"related"]],
    [["BP1","AGREE","Agree joint activities"],["AGREE","BP2","Exchange information"],["AGREE","BP3","Review work products"],["AGREE","BP4","Review progress"],["RELATED","BP2","Consistent interfaces"],["BP2","RECORD","Information exchange"],["BP3","RECORD","Review results"],["BP4","STATUS","Performance and commitments"],["RECORD","BP5","Deviation identified"],["STATUS","BP5","Deviation identified"],["BP5","SUP.9","Corrective action and closure"]]);
  define("PA 2.1",74,"CL2 / CL3 generic practices",
    [["GP2.1.1",90,40],["GP2.1.2",90,270],["GP2.1.3",90,500],["GP2.1.4",690,500],["GP2.1.5",690,40],["GP2.1.6",420,650]],
    [["PLAN","Process performance plan",400,270],["RESOURCE","People, tools, infrastructure and information",690,270],["MAN.3","MAN.3 Work packages, resources, skills, schedule and interfaces",1010,300,"related"]],
    [["GP2.1.1","GP2.1.2","Objectives and strategy"],["GP2.1.2","PLAN","Activities and schedule"],["PLAN","GP2.1.5","Monitor planned performance"],["GP2.1.5","GP2.1.2","Adjust on deviation"],["GP2.1.2","GP2.1.3","Resource requirements"],["GP2.1.3","GP2.1.4","Make resources available"],["GP2.1.4","RESOURCE","Resource availability"],["RESOURCE","GP2.1.5","Monitor resources"],["GP2.1.6","PLAN","Interfaces and commitments"],["MAN.3","PLAN","Project planning context"]]);
  define("PA 2.2",76,"CL2 / CL3 generic practices",
    [["GP2.2.1",430,40],["GP2.2.4",430,250],["GP2.2.2",430,470],["GP2.2.3",430,650]],
    [["SUP.1.2","SUP.1.BP2 Quality criteria",20,40,"related"],["SUP.1.3","SUP.1.BP3 Work product quality",20,250,"related"],["SUP.8.2","SUP.8.BP2 Properties",20,470,"related"],["SUP.8","SUP.8 Modification and baseline control",20,650,"related"],["WP","Process work products",1010,250],["REVIEW","Review records and resolved issues",760,400],["CONTROL","Identification, versions, storage and access",1010,620]],
    [["SUP.1.2","GP2.2.1","Quality criteria"],["GP2.2.1","WP","Define requirements"],["WP","GP2.2.4","Review and adjust"],["SUP.1.3","GP2.2.4","Quality assurance"],["GP2.2.4","REVIEW","Results / adjustments"],["GP2.2.2","GP2.2.3","Documentation and control requirements"],["SUP.8.2","GP2.2.2","Configuration properties"],["SUP.8","GP2.2.3","Change and baseline control"],["GP2.2.3","CONTROL","Document and control"],["CONTROL","WP","Controlled work products"]]);
  define("PA 3.1 / 3.2",78,"CL2 / CL3 generic practices",
    [["GP3.1.1",90,70],["GP3.1.2",420,270],["GP3.1.3",420,450],["GP3.1.4",420,630],["GP3.2.1",990,70],["GP3.2.2",990,270],["GP3.2.3",990,450],["GP3.2.4",990,630]],
    [["STANDARD","Organization standard process",440,70],["DEFINED","Project defined process and tailoring",730,160]],
    [["GP3.1.1","STANDARD","Establish and maintain"],["STANDARD","GP3.2.1","Based on standard process"],["GP3.2.1","DEFINED","Specific context / tailoring"],["GP3.1.1","GP3.1.2","Determine roles and competencies"],["GP3.1.1","GP3.1.3","Determine resources"],["GP3.1.1","GP3.1.4","Monitor effectiveness"],["GP3.1.2","GP3.2.2","Based on standard competencies"],["GP3.1.3","GP3.2.3","Based on standard resources"],["GP3.1.4","GP3.2.4","Based on monitoring methods"]]);

  graphs["MAN.3"].nodes.find(n => n.id === "INPUT").w = 110;
  function pathFor(a,b) {
    const horizontal = Math.abs(b.x-a.x)>Math.abs(b.y-a.y);
    if(horizontal) {
      const sx=b.x>a.x?a.x+a.w:a.x, tx=b.x>a.x?b.x:b.x+b.w, sy=a.y+a.h/2,ty=b.y+b.h/2,mx=(sx+tx)/2;
      return {d:`M${sx} ${sy} H${mx} V${ty} H${tx}`,x:mx,y:(sy+ty)/2};
    }
    const sx=a.x+a.w/2,tx=b.x+b.w/2,sy=b.y>a.y?a.y+a.h:a.y,ty=b.y>a.y?b.y:b.y+b.h,my=(sy+ty)/2;
    return {d:`M${sx} ${sy} V${my} H${tx} V${ty}`,x:(sx+tx)/2,y:my};
  }
  let serial=0;
  function canvas(id,project="",process="",selected="",mini=false,settings) {
    const sourceGraph=graphs[id];
    if(!sourceGraph)return "";
    const graph={...sourceGraph,name:describe(id,settings).name,nodes:sourceGraph.nodes.map(n=>displayNode(id,n,settings)),edges:sourceGraph.edges.map(e=>({...e,label:label(e.label,settings)}))};
    const marker=`af-arrow-${++serial}`;
    const edges=graph.edges.map((edge,index)=>{
      const a=graph.nodes.find(n=>n.id===edge.from),b=graph.nodes.find(n=>n.id===edge.to);
      if(!a||!b)throw new Error(`Invalid canvas edge ${id}: ${edge.from} -> ${edge.to}`);
      const p=pathFor(a,b);
      return `<g class="af-edge" ${mini?"":`role="button" tabindex="0" data-canvas-edge="${index}" aria-label="${escape(edge.from+": "+edge.label+text(settings," 至 "," to ")+edge.to)}"`}><title>${escape(edge.label)}</title><path class="af-edge-hit" d="${p.d}"/><path class="af-edge-line" d="${p.d}" marker-end="url(#${marker})"/>${mini?"":`<foreignObject x="${p.x-65}" y="${p.y-12}" width="130" height="36"><div xmlns="http://www.w3.org/1999/xhtml" class="af-edge-label">${escape(edge.label)}</div></foreignObject>`}</g>`;
    }).join("");
    const nodes=graph.nodes.map(n=>`<foreignObject x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}">${mini?`<div xmlns="http://www.w3.org/1999/xhtml" class="af-node ${n.kind}"></div>`:`<button xmlns="http://www.w3.org/1999/xhtml" type="button" class="af-node ${n.kind} ${selected===n.id?"selected":""}" data-canvas-node="${escape(n.id)}" title="${escape(n.title)}"><strong>${escape(n.kind==="bp"||n.kind==="gp"?n.id:n.kind==="related"?text(settings,"接口","Interface"):n.kind==="input"?text(settings,"输入","Input"):n.kind==="hub"?id:text(settings,"工作产品","Work product"))}</strong><span>${escape(n.title)}</span></button>`}</foreignObject>`).join("");
    const zoomOut=text(settings,"缩小","Zoom out"),zoomIn=text(settings,"放大","Zoom in"),fit=text(settings,"适应画布","Fit canvas");
    return `<div class="af-canvas-root" data-i18n-skip lang="${escape(locale(settings))}" data-canvas="${escape(id)}" data-project="${escape(project)}" data-process="${escape(process||id)}">${mini?"":`<header class="af-canvas-heading"><div><h3>${escape(id)} ${escape(graph.name)}</h3><small>${text(settings,"CSC 培训参考 · 来源页","CSC training reference · source page")} ${graph.page}</small></div><div class="af-canvas-tools"><button type="button" data-canvas-zoom="-" title="${zoomOut}" aria-label="${zoomOut}">−</button><output>100%</output><button type="button" data-canvas-zoom="+" title="${zoomIn}" aria-label="${zoomIn}">+</button><button type="button" data-canvas-zoom="fit" title="${fit}" aria-label="${fit}">⤢</button></div></header>`}<div class="af-canvas-scroll"><svg class="af-canvas-svg" viewBox="-20 -10 1240 770" xmlns="http://www.w3.org/2000/svg" ${mini?'aria-hidden="true"':`role="group" aria-label="${escape(id)} ${text(settings,"交互过程画布","interactive process canvas")}"`}><defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" fill="#477cad"/></marker></defs>${edges}${nodes}</svg></div><div class="af-canvas-detail" aria-live="polite"></div></div>`;
  }
  function info(id, project="", settings) {
    if(!model[id])return ""; const item=describe(id,settings);
    return `<section class="af-process-info" data-i18n-skip lang="${escape(locale(settings))}"><strong>${escape(id)} · ${escape(item.name)}</strong><p>${escape(item.purpose)}</p>${locale(settings)==="en"?"":`<small>中文参考摘要；以原始英文模型为准。</small>`}<h4>${text(settings,"结果","Outcomes")}</h4><ol>${item.outcomes.map(o=>`<li>${escape(o)}</li>`).join("")}</ol><h4>${text(settings,"实践","Practices")}</h4>${item.practices.map(p=>`<button type="button" data-reference-review="${escape(p.code)}" data-project="${escape(project)}" data-process="${escape(id)}"><b>${escape(p.code)}</b><span>${escape(p.title)}</span></button>`).join("")}</section>`;
  }
  function catalog(project="",settings) {
    return `<section class="af-catalog" data-i18n-skip lang="${escape(locale(settings))}"><h2>${text(settings,"过程目录与基本实践","Process catalog and base practices")}</h2>${[...new Set(Object.values(graphs).map(g=>g.group))].map(group=>`<h3>${escape(label(group,settings))}</h3><div class="af-catalog-grid">${Object.values(graphs).filter(g=>g.group===group).map(g=>`<button class="af-catalog-item" type="button" data-canvas-select="${escape(g.id)}" data-project="${escape(project)}"><span class="af-catalog-mini">${canvas(g.id,"","","",true,settings)}</span><strong>${escape(g.id)}</strong><span>${escape(describe(g.id,settings).name)}</span><small>${text(settings,"来源参考页","Reference source page")} ${g.page}</small></button>`).join("")}</div>`).join("")}</section>`;
  }
  function workbench(project,selected,settings) {
    const graphId=graphs[selected]?selected:project.processes?.find(id=>graphs[id])||"MAN.3";
    const process=project.processes?.find(id=>graphs[id])||"MAN.3";
    const tree=Object.values(graphs).map(g=>`<details ${g.id===graphId?"open":""}><summary><button type="button" data-canvas-select="${escape(g.id)}">${escape(g.id)} · ${escape(describe(g.id,settings).name)}</button></summary>${g.nodes.filter(n=>n.kind==="bp"||n.kind==="gp").map(n=>`<button class="af-reference-indicator" type="button" data-canvas-select="${escape(g.id)}" data-reference-review="${escape(n.id)}" data-process="${escape(g.id.startsWith("PA ")?process:g.id)}"><b>${escape(n.id)}</b><span>${escape(displayNode(g.id,n,settings).title)}</span></button>`).join("")}</details>`).join("");
    return `<section class="af-reference-workbench" data-i18n-skip lang="${escape(locale(settings))}" data-project="${escape(project.id)}"><h2>${text(settings,"过程参考","Process reference")}</h2><div class="af-reference-layout"><aside class="af-reference-tree"><header>${text(settings,"汽车 SPICE 4.0","Automotive SPICE 4.0")}</header>${tree}</aside><main class="af-reference-main">${canvas(graphId,project.id,graphId.startsWith("PA ")?process:graphId,"",false,settings)}${info(graphId,project.id,settings)}</main></div>${catalog(project.id,settings)}</section>`;
  }
  function select(event) {
    const target=event.target.closest("[data-canvas-node],[data-canvas-edge],[data-canvas-select],[data-reference-review],[data-canvas-zoom]");
    if(!target)return;
    const root=target.closest(".af-canvas-root"),wb=target.closest(".af-reference-workbench");
    const project=target.dataset.project||root?.dataset.project||wb?.dataset.project||"";
    const settings={language:root?.lang||wb?.lang||document.documentElement?.lang||"en"};
    if(target.dataset.canvasZoom) {
      const svg=root.querySelector(".af-canvas-svg"),value=target.dataset.canvasZoom;
      const zoom=value==="fit"?1:Math.max(.5,Math.min(2.5,Number(svg.dataset.zoom||1)+(value==="+"?.25:-.25)));
      svg.dataset.zoom=zoom;svg.style.width=`${zoom*100}%`;root.querySelector("output").value=`${Math.round(zoom*100)}%`;return;
    }
    if(target.dataset.canvasSelect) {
      const id=target.dataset.canvasSelect;
      if(wb) {wb.querySelector(".af-reference-main").innerHTML=canvas(id,project,target.dataset.process||id,"",false,settings)+info(id,project,settings);wb.querySelectorAll(".af-reference-tree details").forEach(d=>d.open=d.querySelector("[data-canvas-select]")?.dataset.canvasSelect===id);}
      else window.AuditFlowReference.open?.(id,project);
    }
    if(target.dataset.referenceReview) {window.AuditFlowReference.review?.(project,target.dataset.process,target.dataset.referenceReview);return;}
    if(target.dataset.canvasNode) {
      const g=graphs[root.dataset.canvas],n=displayNode(g.id,g.nodes.find(n=>n.id===target.dataset.canvasNode),settings);
      root.querySelectorAll(".af-node").forEach(el=>el.classList.toggle("selected",el===target));
      if(project&&window.AuditFlowReference.editNode){window.AuditFlowReference.editNode(project,root.dataset.process,n.id);return;}
      if(n.kind==="bp"||n.kind==="gp")window.AuditFlowReference.review?.(project,root.dataset.process,n.id);
      else root.querySelector(".af-canvas-detail").innerHTML=`<strong>${escape(n.title)}</strong><p>${escape(n.detail||text(settings,`${g.id} 的${n.kind==="related"?"跨过程接口":"过程工作产品"}`,`${n.kind==="related"?"Cross-process interface":"Process work product"} in ${g.id}.`))}</p><ul>${g.edges.filter(e=>e.from===n.id||e.to===n.id).map(e=>`<li>${escape(e.from)} → ${escape(e.to)}: ${escape(label(e.label,settings))}</li>`).join("")}</ul>`;
    }
    if(target.dataset.canvasEdge!==undefined) {
      const edge=graphs[root.dataset.canvas].edges[Number(target.dataset.canvasEdge)];
      root.querySelector(".af-canvas-detail").innerHTML=`<strong>${escape(label(edge.label,settings))}</strong><p>${escape(edge.from)} → ${escape(edge.to)}</p>`;
    }
  }
  document.addEventListener("click",select);
  document.addEventListener("keydown",event=>{if(event.target.matches(".af-edge")&&(event.key==="Enter"||event.key===" ")){event.preventDefault();select(event);}});
  window.AuditFlowReference={graphs,gp,canvas,info,catalog,workbench,renderProcessReference:workbench,describe,displayNode,label};
})();
