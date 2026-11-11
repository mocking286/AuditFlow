/* ASPICE Introduction Training (Rev1).pptx derived assessment reference.
 *
 * This file is a domain reference layer, not project evidence and not a
 * replacement for Automotive SPICE PAM wording or assessor judgement.
 * Source pages are retained so every default recommendation remains auditable.
 */
(function installAspiceTrainingReference(root) {
  "use strict";

  const common = {
    sourceFile: "ASPICE Introduction Training (Rev1).pptx",
    sourceLabel: "ASPICE Introduction Training (Rev1) · training-derived reference",
    capabilityRules: {
      pages: "11-18",
      guidance: [
        "Rate each BP/GP from objective evidence of the target process; do not infer implementation from a process definition or file name.",
        "N/P/L/F is a candidate interval, not an arithmetic average. The weakest critical practice and evidence quality constrain the process result.",
        "For PA 2.1 check that the process is planned, resourced, performed, monitored and adjusted; for PA 2.2 check work-product criteria, review, configuration and change control.",
        "Formal conclusions require assessor confirmation, representative samples and evidence that is approved, locatable, current and consistent across relevant baselines."
      ]
    },
    testingGuidance: {
      pages: "81-84",
      guidance: [
        "Before starting a test stage, check the previous-stage report, coverage, remaining defects, open change requests and explicit permission to proceed.",
        "At the end of a test stage, baseline at least the test report, coverage, remaining defects and classified open change requests.",
        "Use a controlled defect workflow and trace failures to SUP.9; manual lists alone are not reliable closure evidence.",
        "Regression scope should cover the change, the modified component and directly or indirectly coupled components; where full coverage is impractical, document a strategic risk-based decision.",
        "Maintain bidirectional links across requirements, architecture, design, units, test specifications, test cases and results."
      ]
    },
    generalAdvice: {
      pages: "11-18, 81-84",
      bp: "Check the stated activity, input, output, responsibility, approval, version/baseline, traceability and result. Ask for one recent implementation sample and one cross-version or cross-milestone sample.",
      gp21: "PA 2.1: verify an explicit process objective, plan, resources, responsibilities, schedule, monitoring data, deviation handling and interface commitments.",
      gp22: "PA 2.2: verify work-product requirements, review/approval criteria, configuration and change control, status visibility and evidence that nonconformances are resolved.",
      evidence: "Prefer locatable project records with owner, date, version/baseline, approval, inputs, outputs and results. Related-process evidence is corroborating and cannot replace direct target-process evidence.",
      closure: "Minimum closure normally combines the updated controlled work product, adoption in the project, review/approval, verification or effectiveness result, and the relevant baseline or configuration record."
    }
  };

  const processes = {
    "SYS.2": {
      name: "System Requirements Analysis",
      purpose: "Transform stakeholder requirements into an agreed, analysed and verifiable set of system requirements that guides system design.",
      outcomes: "Defined and structured system requirements; correctness, verifiability, operating-environment and impact analysis; prioritisation; updates; consistency and bidirectional traceability; cost, schedule and technical impact; agreement and communication.",
      pages: "20-28",
      workProducts: ["System requirements specification", "Stakeholder and system requirements traceability record", "Verification criteria", "Interface requirements specification", "Review record", "Communication record", "Change control record"],
      focus: ["Review customer or stakeholder agreement before deriving downstream requirements.", "Check functional and non-functional requirements, verification criteria, operating-environment impact and release prioritisation.", "Sample bidirectional links and review records across customer, system, verification and change views."],
      risks: ["Unagreed requirements are used to derive software requirements.", "Requirements are readable but not verifiable or not linked to their source.", "System, software, hardware and mechanical stakeholders do not jointly review the baseline."],
      bp: {
        BP1: "Confirm stakeholder requirements and approved changes are transformed into functional and non-functional system requirements with source attribution.",
        BP2: "Check grouping, categorisation, logical structure and release prioritisation in the system requirements specification.",
        BP3: "Inspect correctness, interdependencies, feasibility, verifiability, risks and cost/schedule/technical impact analysis.",
        BP4: "Check interfaces with the operating environment and evidence that requirement impacts on those interfaces were analysed.",
        BP5: "Verify qualitative and quantitative verification criteria exist for each system requirement and can feed system test design.",
        BP6: "Sample bidirectional stakeholder-to-system links for coverage, consistency and impact analysis, not just a one-way matrix.",
        BP7: "Check review evidence demonstrates consistency between stakeholder and system requirements and identifies unresolved contradictions.",
        BP8: "Verify agreed requirements and updates were communicated to all affected parties, with approval or sign-off recorded."
      }
    },
    "SYS.3": {
      name: "System Architectural Design",
      purpose: "Establish the system architecture, allocate system requirements to system elements, define interfaces and dynamic behaviour, and evaluate the architecture.",
      outcomes: "System elements and architecture; requirement allocation; element interfaces; dynamic behaviour; consistency and bidirectional traceability; agreement and communication.",
      pages: "29-34",
      workProducts: ["System architectural design", "Interface requirements specification", "Traceability record", "Review record", "Communication record"],
      focus: ["Check architecture is derived from agreed system requirements.", "Compare alternatives against explicit quality, risk, cost, schedule and technical criteria.", "Review allocation, interface, dynamic-behaviour, consistency and communication evidence."],
      risks: ["Architecture approval omits affected technical experts or customer representatives.", "Alternative solutions and rationale are not recorded.", "Allocation and interface links cannot be followed in both directions."],
      bp: {
        BP1: "Check the architectural decomposition and system boundaries against functional and non-functional system requirements.",
        BP2: "Sample requirement-to-element allocations and verify every allocation has a clear rationale and downstream owner.",
        BP3: "Inspect internal and external interface definitions including data, timing, resources, safety and security constraints.",
        BP4: "Verify operating modes and interactions are described with state, sequence or data-flow evidence.",
        BP5: "Check explicit evaluation criteria, alternatives, make/buy/reuse considerations and rationale for the selected architecture.",
        BP6: "Sample bidirectional traceability between system requirements and architectural elements and use it for impact analysis.",
        BP7: "Inspect review records for consistency across requirements, views, allocations, interfaces and architecture decisions.",
        BP8: "Verify the agreed architecture and updates were approved and communicated to all relevant parties."
      }
    },
    "SWE.1": {
      name: "Software Requirements Analysis",
      purpose: "Transform the software-related parts of system requirements and architecture into agreed, analysed and verifiable software requirements.",
      outcomes: "Defined, structured and prioritised software requirements; correctness, verifiability and environment-impact analysis; updates; consistency and bidirectional traceability to system requirements and architecture; impact evaluation; agreement and communication.",
      pages: "35-41",
      workProducts: ["Software requirements specification", "Interface requirements specification", "Verification criteria", "Traceability record", "Review record", "Communication record", "Analysis report", "Change control record"],
      focus: ["Check software requirements are based on agreed system requirements and architecture.", "Review functional, non-functional, interface, resource, safety and security requirements.", "Verify testability, two-way traceability, stakeholder agreement and controlled evolution through SUP.10."],
      risks: ["Software requirements are copied without analysing operating-environment impact.", "Verification criteria are postponed until test execution.", "Developers and testers are not involved in requirements approval."],
      bp: {
        BP1: "Confirm software requirements are derived from current system requirements, architecture and approved changes, including functional and non-functional needs.",
        BP2: "Check logical grouping, categorisation, prioritisation and release allocation in the software requirements specification.",
        BP3: "Inspect correctness, interdependencies, feasibility, verifiability, risks and cost/schedule/technical impact analysis.",
        BP4: "Check impact on hardware, operating system, interfaces, resources and other elements of the execution environment.",
        BP5: "Verify measurable verification criteria and constraints exist for each software requirement and can drive test specifications.",
        BP6: "Sample bidirectional links between system requirements, system architecture and software requirements, including change impact.",
        BP7: "Check review records demonstrate consistency across system requirements, architecture and software requirements.",
        BP8: "Verify the agreed software requirements baseline and updates were approved, communicated and linked to change control."
      }
    },
    "SWE.2": {
      name: "Software Architectural Design",
      purpose: "Establish the software architecture, allocate software requirements, define interfaces and dynamic/resource objectives, and evaluate alternatives.",
      outcomes: "Software elements and architecture; allocation; interfaces; dynamic behaviour and resource objectives; consistency and bidirectional traceability; agreement and communication.",
      pages: "42-48",
      workProducts: ["Software architectural design", "Interface requirements specification", "Traceability record", "Review record", "Communication record"],
      focus: ["Check static and dynamic architecture views, task/process communication and resource consumption.", "Review variant, platform, reuse and make/buy decisions.", "Consider a controlled SWE.2 baseline containing the architecture and related records."],
      risks: ["Architecture ignores timing, memory, CPU, data integrity or variant constraints.", "Only a structural diagram exists without dynamic behaviour or interface semantics.", "The selected architecture has no recorded alternatives or rationale."],
      bp: {
        BP1: "Inspect the decomposition into software elements down to components and confirm coverage of functional and non-functional requirements.",
        BP2: "Sample software-requirement allocations to architectural elements and check allocation completeness and rationale.",
        BP3: "Check each software-element interface for data, timing, ownership, error handling and dependency constraints.",
        BP4: "Inspect modes, tasks, threads, interrupts, synchronisation and timing interactions on the target platform.",
        BP5: "Verify CPU, ROM, RAM, EEPROM/flash and other resource-consumption objectives are defined at appropriate levels.",
        BP6: "Check alternatives against explicit quality, reuse, platform, variant, security, reliability and maintainability criteria.",
        BP7: "Sample bidirectional links between software requirements and architectural elements and use them for impact analysis.",
        BP8: "Inspect review records for consistency between requirements, interfaces, dynamic views, resource objectives and architecture.",
        BP9: "Verify the agreed software architecture and updates were approved, baselined and communicated to affected parties."
      }
    },
    "SWE.3": {
      name: "Software Detailed Design and Unit Construction",
      purpose: "Provide an evaluated detailed design for software components and specify and produce software units.",
      outcomes: "Detailed design and unit interfaces; unit dynamic behaviour; consistency and bidirectional traceability across requirements, architecture, detailed design and units; agreement and communication; produced units.",
      pages: "49-54",
      workProducts: ["Software detailed design", "Software unit", "Traceability record", "Review record", "Communication record"],
      focus: ["Review algorithms, data structures, interfaces, timing, interrupts, resource needs and error handling.", "Check design evaluation covers interoperability, criticality, complexity, risk and testability.", "Verify code/unit output is controlled and linked to the approved detailed design."],
      risks: ["Detailed design is too abstract to implement or verify.", "Code is present but its design, interface and traceability are not controlled.", "Changes to a unit are not synchronised with design and unit tests."],
      bp: {
        BP1: "Check each architectural software component has a detailed design that specifies its software units and relevant functional/non-functional behaviour.",
        BP2: "Inspect unit input/output interfaces, data formats, ownership, errors and dependencies.",
        BP3: "Verify state, sequence, control-flow and interaction behaviour is described where applicable.",
        BP4: "Check the detailed-design evaluation addresses interoperability, interaction, criticality, complexity, risk and testability.",
        BP5: "Sample bidirectional traceability across requirements, architecture, detailed design and software units.",
        BP6: "Inspect review evidence for consistency between requirements, architecture, detailed design and implemented units.",
        BP7: "Verify the agreed detailed design and updates were communicated and approved before dependent work proceeds.",
        BP8: "Confirm executable units are produced according to the detailed design, coding rules and controlled version."
      }
    },
    "SWE.4": {
      name: "Software Unit Verification",
      purpose: "Verify software units against the software detailed design and non-functional software requirements.",
      outcomes: "Unit verification and regression strategy; suitable criteria; recorded execution results; consistency and bidirectional traceability; summarised and communicated results.",
      pages: "55-60",
      workProducts: ["Test specification", "Test result", "Verification results", "Verification checklist", "Traceability record", "Review record", "Analysis report", "Communication record"],
      focus: ["Check the strategy covers static verification, code review, unit testing and regression.", "Review pass/fail/pending items, defects, risk and action recommendations.", "Baseline unit verification records when the stage is complete."],
      risks: ["Unit tests exist without a strategy, criteria or regression decision.", "Static analysis and code review are omitted.", "Failed results are not linked to SUP.9 or the affected design/unit revision."],
      bp: {
        BP1: "Verify a unit-verification and regression strategy defines methods, scope, environment, coverage and change-triggered re-verification.",
        BP2: "Check verification criteria are suitable for detailed-design and non-functional compliance, including test data and coverage goals.",
        BP3: "Inspect static-analysis or code-review results, criteria, findings, deviations and disposition.",
        BP4: "Inspect executable unit-test logs and results, including environment, input, expected/actual result and re-test.",
        BP5: "Sample bidirectional links between units, static results, detailed design, test specifications and test results.",
        BP6: "Check review records demonstrate consistency between detailed design and unit-test specification.",
        BP7: "Verify results are summarised with coverage, failures, open defects, residual risk and communication to affected parties."
      }
    },
    "SWE.5": {
      name: "Software Component Verification and Integration Verification",
      purpose: "Integrate software units into software items and a complete integrated software, then verify interfaces and compliance with the software architecture.",
      outcomes: "Integration strategy; integration and regression test strategy; test specification; staged integration; selected and executed tests; traceability and consistency; summary and communication.",
      pages: "61-66",
      workProducts: ["Software integration strategy", "Integration test strategy", "Integration test specification", "Integration test results", "Traceability record", "Review record", "Communication record"],
      focus: ["Check integration order, increments, environment, entry/exit criteria and release alignment.", "Test data flow, timing, interface interpretation, dynamic interaction and resource objectives.", "Use SUP.9 for nonconformances and baseline the completed integration evidence."],
      risks: ["Integration sequence is not derived from architecture or release plan.", "Tests cover component existence but not interface semantics and timing.", "Integration failures or environmental limitations are not tracked to closure."],
      bp: {
        BP1: "Check the integration sequence and increments are derived from the software architecture, project plan and release plan.",
        BP2: "Verify integration and regression strategy covers changed items, affected interfaces and coupled components.",
        BP3: "Inspect integration test cases for data flow, timing, dynamic interaction, interface interpretation and resource objectives.",
        BP4: "Confirm units and software items are integrated in the planned order with versions, environment and anomalies recorded.",
        BP5: "Check test-case selection has sufficient risk-based coverage for the strategy and release scope.",
        BP6: "Inspect execution logs, results, failures, deviations and links to SUP.9 problem records.",
        BP7: "Sample bidirectional links between architecture elements, test cases and test results.",
        BP8: "Check architecture-to-test consistency by review, including interface and coverage rationale.",
        BP9: "Verify integration results are summarised with coverage, open defects, residual risk and communication."
      }
    },
    "SWE.6": {
      name: "Software Qualification Test",
      purpose: "Test the integrated software to provide evidence of compliance with software requirements.",
      outcomes: "Qualification and regression strategy; test specification; selected cases; executed tests and results; traceability and consistency; summary and communication.",
      pages: "67-70",
      workProducts: ["Software test strategy", "Software qualification test specification", "Software qualification test results", "Traceability record", "Review record", "Communication record"],
      focus: ["Check qualification tests are derived from software requirements and verification criteria.", "Review environment, release scope, selected cases, failures, regression and remaining risk.", "Confirm test-stage entry/exit and result baselines."],
      risks: ["Qualification test cases are copied from lower-level tests without requirement coverage.", "Test environment and release configuration are not controlled.", "Open defects and re-test decisions are not visible to affected parties."],
      bp: {
        BP1: "Verify qualification and regression strategy is consistent with the project/release plan and addresses changes to integrated software.",
        BP2: "Check the test specification and cases can demonstrate compliance with software requirements and verification criteria.",
        BP3: "Review case selection for sufficient coverage, risk, release scope and explicit exclusions.",
        BP4: "Inspect integrated-software execution logs, results, environment, failures and nonconformance handling.",
        BP5: "Sample bidirectional links from software requirements to qualification cases and from cases to results.",
        BP6: "Check review evidence demonstrates consistency between software requirements and the qualification test specification.",
        BP7: "Verify results are summarised with coverage, open defects, regression status, residual risk and communication."
      }
    },
    "SYS.4": {
      name: "System Integration and Integration Verification",
      purpose: "Integrate system items into an integrated system and verify interfaces and compliance with the system architectural design.",
      outcomes: "Integration and regression strategies; system integration test specification; staged integration; selected and executed tests; traceability and consistency; summary and communication.",
      pages: "71-76",
      workProducts: ["System integration strategy", "System integration test strategy", "System integration test specification", "System integration test results", "Traceability record", "Review record", "Communication record"],
      focus: ["Check system integration increments, environment and interfaces across software, hardware, mechanics and peripherals.", "Test signal flow, timing, interpretation and dynamic interaction, using simulation/HIL where justified.", "Verify entry/exit criteria, defect tracking and a result baseline."],
      risks: ["System integration is treated as a build activity without architectural interface verification.", "Test environment, stubs, drivers or HIL limitations are not planned.", "Results cannot be traced back to architecture elements and selected cases."],
      bp: {
        BP1: "Check integration sequence and system items are derived from the architecture, project plan and release plan.",
        BP2: "Verify integration and regression strategy covers changed system items, interfaces and coupled elements.",
        BP3: "Inspect test cases for signals, timing, interface interpretation and dynamic interaction against architectural interface descriptions.",
        BP4: "Confirm staged integration of hardware, software, mechanics and peripherals is recorded with versions and environment.",
        BP5: "Check case selection provides sufficient risk-based coverage for the integration strategy and release scope.",
        BP6: "Inspect execution logs, results, failures, deviations and SUP.9 links.",
        BP7: "Sample bidirectional links between architecture elements, test cases and system integration results.",
        BP8: "Check architecture-to-test consistency through review records and coverage analysis.",
        BP9: "Verify results are summarised with coverage, open defects, residual risk and communication."
      }
    },
    "SYS.5": {
      name: "System Qualification Test",
      purpose: "Test the integrated system to provide evidence of compliance with system requirements.",
      outcomes: "System qualification and regression strategy; test specification; selected cases; executed tests and results; traceability and consistency; summary and communication.",
      pages: "77-80",
      workProducts: ["System test strategy", "System qualification test specification", "System qualification test results", "Traceability record", "Review record", "Communication record"],
      focus: ["Check system qualification cases are derived from system requirements and verification criteria.", "Review representative operational scenarios, environment, release configuration, failures and regression.", "Confirm remaining defects and permission to proceed are explicitly managed."],
      risks: ["System tests prove only nominal behaviour and omit requirements or operational constraints.", "Test results are not tied to the tested baseline.", "Open nonconformances are not assessed for release impact."],
      bp: {
        BP1: "Verify system qualification and regression strategy aligns with project/release plans and changed system items.",
        BP2: "Check test specification and cases can demonstrate compliance with system requirements and verification criteria.",
        BP3: "Review selected cases for requirement coverage, operational risk and release scope.",
        BP4: "Inspect integrated-system results, logs, environment, configuration and nonconformance handling.",
        BP5: "Sample bidirectional links between system requirements, test cases and test results.",
        BP6: "Check review evidence demonstrates consistency between system requirements and qualification test specification.",
        BP7: "Verify results are summarised with coverage, remaining defects, regression decision, risk and communication."
      }
    },
    "SUP.1": {
      name: "Quality Assurance",
      purpose: "Provide independent and objective assurance that process and work-product quality requirements are met.",
      outcomes: "QA strategy; work-product and process quality assurance; documented results; communication; nonconformance resolution; escalation.",
      pages: "85-90",
      workProducts: ["Quality assurance strategy/plan", "Quality record", "Quality criteria", "Corrective action register", "Problem record", "Communication record"],
      focus: ["Check independence, objective criteria, scheduled activities, ownership and escalation.", "Verify QA covers both product and process quality and feeds SUP.9/PIM.3 when appropriate.", "Review trend reporting and evidence of corrective-action effectiveness."],
      risks: ["QA is planned but not independent or is treated as the QA department doing all quality work.", "Findings are recorded without ownership, escalation or closure verification.", "QA activities are absent from the WBS and schedule."],
      bp: {
        BP1: "Inspect the project QA strategy for independence, objective criteria, scope, responsibilities, schedule and interfaces.",
        BP2: "Sample work-product assurance records against defined requirements, applicable standards and approval criteria.",
        BP3: "Sample process-assurance records against process goals, planned activities and objective results.",
        BP4: "Check regular reports communicate performance, deviations, trends and required actions to affected parties.",
        BP5: "Verify nonconformances are analysed, tracked, corrected, prevented and linked to SUP.9 or process improvement where appropriate.",
        BP6: "Inspect escalation rules, decision records and evidence that unresolved quality risks reached the right management level."
      }
    },
    "SUP.8": {
      name: "Configuration Management",
      purpose: "Establish and maintain the integrity of project/process work products and make them available to affected parties.",
      outcomes: "Configuration strategy; identified and baselined configuration items; controlled modifications/releases; availability; status reporting; complete and consistent baselines; controlled storage.",
      pages: "91-96",
      workProducts: ["Configuration management plan/strategy", "Configuration item", "Configuration record/history", "Baseline", "Configuration management system", "Change history", "Recovery plan"],
      focus: ["Check CI criteria, repositories, roles, access, branch/merge, baseline, audit, backup and recovery.", "Sample revisions, status, baseline completeness and release availability.", "Use configuration status to corroborate MAN.3 progress and test/release decisions."],
      risks: ["Configuration items are named but not baselined or access-controlled.", "Baseline completeness and consistency are asserted without an audit.", "Backups, archival and recovery do not cover the required lifetime."],
      bp: {
        BP1: "Inspect CM strategy for responsibilities, tools, CI criteria, naming, access, baselines, branching/merging and revision history.",
        BP2: "Sample identification and classification of delivered, internal, acquired and tool-related configuration items.",
        BP3: "Verify the CM system implements the strategy, preserves history and makes controlled items available.",
        BP4: "Check branch and merge decisions, authorisation and verification of parallel development integration.",
        BP5: "Inspect controlled modification and release records, including links to SUP.10 and affected work products.",
        BP6: "Sample internal and delivery baselines for scope, approval, content and release linkage.",
        BP7: "Review status reporting for work, checked-in, tested, released and blocked configuration items.",
        BP8: "Inspect baseline or configuration audits for completeness, consistency and reconciliation to source records.",
        BP9: "Verify storage, backup, archival and recovery protect the integrity and availability of items and baselines."
      }
    },
    "SUP.9": {
      name: "Problem Resolution Management",
      purpose: "Ensure problems are identified, analysed, managed and controlled to resolution.",
      outcomes: "Problem-resolution strategy; unique identification/classification; analysis and solution; initiated resolution; closure tracking; status and trend visibility.",
      pages: "97-103",
      workProducts: ["Problem management plan", "Problem record", "Problem status report", "Analysis report", "Evaluation report"],
      focus: ["Check reproducibility, cause, impact, severity, urgency, ownership and related changes.", "Verify authorised urgent action, notifications, closure acceptance and trend analysis.", "Trace recurring or product-related problems into SUP.10, SUP.1, MAN.3 or PIM.3 as appropriate."],
      risks: ["Problem tickets contain symptoms but no reproducibility, cause or impact analysis.", "Problems are closed without formal acceptance or verification.", "Trend analysis does not trigger preventive action."],
      bp: {
        BP1: "Inspect the strategy for activities, status model, responsibilities, alerts, interfaces and urgent-resolution rules.",
        BP2: "Sample uniquely identified records with description, origin, reproduction steps, environment, detector and supporting evidence.",
        BP3: "Check status transitions are controlled and visible for every problem.",
        BP4: "Inspect cause, impact, categorisation, criticality, urgency and action analysis.",
        BP5: "Verify urgent resolutions have explicit authorisation according to the strategy.",
        BP6: "Check high-impact problems trigger timely alerts to affected parties with records of notification.",
        BP7: "Verify resolution actions or change requests are initiated, reviewed and linked to affected work products.",
        BP8: "Inspect closure tracking, related change requests and formal acceptance before closure.",
        BP9: "Review trend data, recurrence analysis and evidence of preventive action."
      }
    },
    "SUP.10": {
      name: "Change Request Management",
      purpose: "Ensure change requests are managed, tracked and implemented.",
      outcomes: "Change strategy; identified requests; relationships/dependencies; confirmation criteria; analysis and resource estimates; approval/prioritisation; implementation and closure; status visibility; bidirectional traceability.",
      pages: "104-109",
      workProducts: ["Change management plan", "Change request", "Change control record", "Review record"],
      focus: ["Check CCB or equivalent authority, status model, impact analysis and confirmation criteria.", "Trace each change to affected requirements, design, code, tests, baselines and originating problems.", "Verify implementation review, feedback and closure."],
      risks: ["Changes are implemented before approval or impact analysis.", "Status is visible but affected work products and tests are not traced.", "A closed change lacks confirmation evidence and baseline linkage."],
      bp: {
        BP1: "Inspect change strategy for activities, status model, analysis criteria, responsibilities and affected-party interfaces.",
        BP2: "Sample uniquely identified requests with initiator, reason, description and supporting context.",
        BP3: "Check each request has a controlled status according to the defined model.",
        BP4: "Inspect dependency, affected-work-product, risk, resource, schedule and confirmation-criteria analysis.",
        BP5: "Verify prioritisation and approval occur before implementation through CCB or an equivalent authorised mechanism.",
        BP6: "Check implementation review confirms the defined criteria and all relevant processes were applied.",
        BP7: "Inspect tracking to closure, feedback to the initiator and evidence of residual impact.",
        BP8: "Sample bidirectional links from change requests to affected work products and originating SUP.9 problem records."
      }
    },
    "MAN.3": {
      name: "Project Management",
      purpose: "Identify, establish and control project activities and resources needed to produce the product within requirements and constraints.",
      outcomes: "Scope; feasibility; activities and resource estimates; interfaces and commitments; maintained plans; progress monitoring/reporting; corrective action and recurrence prevention.",
      pages: "110-116",
      workProducts: ["Project plan", "WBS", "Schedule", "Project status report", "Stakeholder groups list", "Review record", "Communication record", "Corrective action register", "Change request"],
      focus: ["Check scope, lifecycle, WBS, estimates, resources, skills, interfaces, commitments, schedule, baselines and forecast.", "Verify all engineering and support processes are represented in plans and dependencies.", "Inspect corrective action, lessons learned and consistency across plan, estimate, schedule and status records."],
      risks: ["Plans list milestones but omit process activities, ownership, dependencies or resources.", "Estimates and schedules drift without forecast or corrective action.", "Project interfaces and commitments are not monitored across suppliers and support functions."],
      bp: {
        BP1: "Confirm project goals, motivation, boundaries, deliverables and assumptions define the scope of work.",
        BP2: "Check the lifecycle and methodology fit project scope, context, size, complexity and customer process.",
        BP3: "Inspect technical feasibility, time, estimate, resource, risk and constraint analysis.",
        BP4: "Check activities and dependencies are defined, monitored and adjusted across engineering, management and support work.",
        BP5: "Review effort/resource estimation method, assumptions, risks, historical basis and controlled re-planning.",
        BP6: "Verify required skills, knowledge and experience are identified and gaps are addressed before needed.",
        BP7: "Inspect agreed interfaces, commitments, stakeholders, dependencies and monitoring evidence.",
        BP8: "Check the schedule contains sequence, dependencies, resources, milestones, durations and current forecasts.",
        BP9: "Verify estimates, activities, schedules, plans, interfaces and commitments are consistent across parties.",
        BP10: "Inspect regular status review/reporting against effort, duration, milestones and corrective actions, including recurrence prevention."
      }
    },
    "ACQ.4": {
      name: "Supplier Monitoring",
      purpose: "Track and assess supplier performance against agreed requirements.",
      outcomes: "Joint processes and activities; regular information exchange; monitoring against agreements; documented negotiation of agreement changes.",
      pages: "117-120",
      workProducts: ["Commitment/agreement", "Communication record", "Meeting support record", "Progress status record", "Review record", "Analysis report", "Acceptance record", "Customer request", "Change request"],
      focus: ["Check joint process, interface, responsibility, information, meeting and reporting agreements.", "Review technical, schedule, quality and cost performance with open-item closure.", "Verify deviations lead to corrective action, negotiated agreement changes and acceptance evidence."],
      risks: ["Supplier reporting is regular but not compared with agreed objectives.", "Technical risks and open items are discussed but not tracked to closure.", "Agreement changes are made informally without negotiation or record."],
      bp: {
        BP1: "Inspect the maintained customer-supplier agreement for joint processes, interfaces, responsibilities, information, frequency and escalation.",
        BP2: "Sample exchanged information against the agreed interface, cadence, format and affected-party list.",
        BP3: "Check regular technical reviews cover development, problems, risks and open items to closure.",
        BP4: "Check supplier progress reviews cover schedule, quality, cost, risk mitigation and open-item closure.",
        BP5: "Verify deviations trigger corrective action, recurrence prevention or a documented negotiation and agreement update."
      }
    }
  };

  const reference = {
    version: "6.3.0",
    standard: "Automotive SPICE 4.0",
    common,
    processes,
    supportedProcesses: Object.keys(processes),
    get(processId) {
      return processes[String(processId || "").trim()] || null;
    },
    forAssessment(processId, kind, pa, code) {
      const process = processes[String(processId || "").trim()];
      const practice = process?.bp?.[String(code || "").toUpperCase()] || "";
      const paAdvice = String(kind || "").toUpperCase() === "GP"
        ? (String(pa || "").toUpperCase().includes("2.1") ? common.generalAdvice.gp21 : common.generalAdvice.gp22)
        : practice || common.generalAdvice.bp;
      return {
        sourceFile: common.sourceFile,
        sourceLabel: common.sourceLabel,
        processPages: process?.pages || "",
        referencePages: process?.pages || common.generalAdvice.pages,
        purpose: process?.purpose || "",
        outcomes: process?.outcomes || "",
        workProducts: process?.workProducts || [],
        focus: process?.focus || [],
        risks: process?.risks || [],
        advice: paAdvice,
        commonEvidence: common.generalAdvice.evidence,
        closure: common.generalAdvice.closure,
        testingGuidance: common.testingGuidance.guidance
      };
    }
  };

  root.AuditFlowAspiceTrainingReference = reference;
})(globalThis);
