#!/usr/bin/env python3
"""Extract the local SUP/QA checklist templates into a browser-safe catalog."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from openpyxl import load_workbook


SOURCE_ROOT = Path(os.environ.get("AUDITFLOW_SUP_SOURCE_ROOT", str(Path.home() / "Downloads" / "SUP.1")))
CHECKLIST_ROOT = Path(os.environ.get("AUDITFLOW_CHECKLIST_ROOT", str(Path.home() / "Downloads" / "01_Checklist")))
OUTPUT = Path(os.environ.get(
    "AUDITFLOW_CHECKLIST_OUTPUT",
    Path(__file__).resolve().parents[1] / "src" / "AuditFlowDesktop" / "WebApp" / "sup-qa-checklist-catalog.js",
))
RELEASE_VERSION = os.environ.get("AUDITFLOW_RELEASE_VERSION", "6.9.0")

PROCESS_MAP = {
    "Configuration Management Process Audit Checklist.xlsx": "SUP.8",
    "Problem Resolution Management Process Audit Checklist.xlsx": "SUP.9",
    "Change Request Management Process Audit Checklist.xlsx": "SUP.10",
    "Project Management Process  Checklist.xlsx": "MAN.3",
    "Software Release process Checklist.xlsx": "SPL.2",
    "Lessons Learned process Checklist.xlsx": "PIM.3",
}

CLOSURE = {
    "SUP.1": [
        "独立 QA 计划与抽样依据，包含责任、范围和审查日期",
        "可定位的过程/工作产品检查记录、问题升级和质量状态报告",
        "不符合项进入 SUP.9，并由评估师确认关闭有效性",
    ],
    "SUP.8": [
        "配置项清单、唯一标识、版本/状态和访问控制记录",
        "批准的基线或发布快照，包含变更历史和完整性核验",
        "状态核算/配置审计结果，能够回溯到相关问题和变更",
    ],
    "SUP.9": [
        "唯一问题记录、影响/根因分析、责任人与截止日期",
        "纠正措施及其验证结果，含回归或有效性证据",
        "关闭批准、趋势/重开/升级记录，以及受影响工作产品链接",
    ],
    "SUP.10": [
        "变更请求唯一编号、发起原因、影响/风险/工作量分析",
        "实施前批准、受影响工作产品清单和实施记录",
        "验证结果、通知/反馈、SUP.8 基线更新和关闭批准",
    ],
    "MAN.3": [
        "批准的范围、生命周期、WBS、里程碑和资源/职责计划",
        "项目状态、偏差、风险、问题和纠正措施的周期性记录",
        "阶段/项目关闭评审、经验复盘与受控工作产品",
    ],
    "SPL.2": [
        "发布内容、准入准则、受控配置项和唯一发布标识",
        "发布批准、发布说明、验证状态和未解决限制",
        "由 SUP.8 基线组装并交付的可复现发布包",
    ],
    "PIM.3": [
        "经验条目唯一 ID、根因、行动和受影响工作产品",
        "行动责任人、期限、跟踪记录和关闭验证",
        "经验文档版本、基线和组织/项目复用记录",
    ],
}

EXPECTED = {
    "SUP.1": "QA 计划、抽样清单、评审记录、质量报告、NC/升级记录",
    "SUP.8": "CM 计划、CI 清单、基线/快照、状态核算、配置审计记录",
    "SUP.9": "问题台账、根因/影响分析、纠正措施、验证和关闭记录",
    "SUP.10": "CR 策略、CR 台账、影响分析、批准、实施/验证和关闭记录",
    "MAN.3": "项目计划、WBS、里程碑、风险/问题台账、状态报告、阶段评审",
    "SPL.2": "发布准则、发布包、发布说明、验证状态、发布批准记录",
    "PIM.3": "经验条目、根因和行动台账、跟踪/关闭及受控复用记录",
    "SYS.2": "系统需求规格说明、需求属性、追溯矩阵、评审/批准和基线记录",
    "SYS.3": "系统架构设计、接口/约束说明、需求覆盖矩阵、评审和批准记录",
    "SYS.4": "系统测试计划/报告、测试用例与结果、需求覆盖、缺陷和批准记录",
    "SWE.1": "软件需求规格说明、需求属性、系统追溯、评审/批准和基线记录",
    "SWE.2": "软件架构设计、软件元素/接口说明、需求分配和评审记录",
    "SWE.3": "软件详细设计、接口/资源说明、需求分配、评审和批准记录",
    "SWE.5": "软件集成测试计划/报告、测试用例与结果、缺陷和需求覆盖记录",
}

GENERIC_CLOSURE = [
    "已批准的工作产品版本、评审范围和可定位的原始证据",
    "逐条记录的评审结论、问题/偏差、责任人和处置期限",
    "纠正措施验证、复评结论、基线更新和授权关闭记录",
]

CHECKLIST_PROCESS_MAP = {
    "Project_plan_document_review_checklist.xlsx": {"process": "MAN.3"},
    "QualityPlan_Review_Checklist.xlsx": {"process": "SUP.1"},
    "SRS_Review_Checklist.xlsx": {"process": "SYS.2"},
    "Software Integration Test Case Review Checklist.xlsx": {"process": "SWE.5"},
    "SysTestPlan_Review_Checklist.xlsx": {"process": "SYS.4", "relatedProcesses": ["SYS.5"]},
    "SysTestReport_Review_Checklist.xlsx": {"process": "SYS.4", "relatedProcesses": ["SYS.5"]},
    "System_TestReport_Review_Checklist.xlsx": {"process": "SYS.4", "relatedProcesses": ["SYS.5"]},
    "Software_ Detailed_Design_Review_Checklist_ADC.xlsx": {"process": "SWE.3"},
    "Software Architectural Design Review Checklist.xlsx": {"process": "SWE.2"},
    "Software_Requirement_Specification_Review_Checklist.xlsx": {"process": "SWE.1"},
    "System_Architecture_Review_Checklist.xlsx": {"process": "SYS.3"},
    "System_Requirement_Review_Checklist.xlsx": {"process": "SYS.2"},
}

STRATEGY_PROCESS_MAP = {
    "quality plan": {"process": "SUP.1"},
    "project plan": {"process": "MAN.3"},
    "je internal / cus requirement spec": {"process": "SYS.2"},
    "system specification": {"process": "SYS.2"},
    "system architecture specification": {"process": "SYS.3"},
    "system test plan": {"process": "SYS.4", "relatedProcesses": ["SYS.5"]},
    "software specification": {"process": "SWE.1"},
    "software test plan": {"process": "SWE.5"},
    "system verification test report": {"process": "SYS.4", "relatedProcesses": ["SYS.5"]},
    "software verification test report": {"process": "SWE.5"},
}


def normalized_header(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text(value).lower()).strip()


def slug(value: object) -> str:
    result = re.sub(r"[^A-Za-z0-9]+", "-", text(value)).strip("-").upper()
    return result or "SOURCE"


def mapped_process(file_name: str) -> dict[str, object]:
    return dict(CHECKLIST_PROCESS_MAP.get(file_name, {"process": "SUP.1"}))


def expected_for(process: str) -> str:
    return EXPECTED.get(process, "受控工作产品、评审记录、可定位证据、问题闭环和批准/基线记录")


def closure_for(process: str) -> list[str]:
    return CLOSURE.get(process, GENERIC_CLOSURE)


def header_row(rows: list[tuple[object, ...]]) -> tuple[int, dict[str, int]] | None:
    for row_index, row in enumerate(rows, start=1):
        headers = {normalized_header(value): index for index, value in enumerate(row)}
        category = next((index for key, index in headers.items() if key == "category"), None)
        contents = next((index for key, index in headers.items() if key == "contents"), None)
        if category is not None and contents is not None:
            number = next((index for key, index in headers.items() if key in {"no", "no."}), None)
            work_products = next((index for key, index in headers.items() if "work products" in key), None)
            return row_index, {
                "category": category,
                "number": number if number is not None else max(contents - 1, 0),
                "contents": contents,
                "workProducts": work_products if work_products is not None else -1,
            }
    return None


def source_manifest() -> list[dict[str, object]]:
    if not CHECKLIST_ROOT.is_dir():
        return []
    manifest: list[dict[str, object]] = []
    for path in sorted(CHECKLIST_ROOT.rglob("*.xlsx")):
        relative_path = path.relative_to(CHECKLIST_ROOT).as_posix()
        mapping = mapped_process(path.name)
        manifest.append({
            "sourceDocument": path.name,
            "sourcePath": relative_path,
            "sourceGroup": relative_path.split("/", 1)[0] if "/" in relative_path else "",
            "recordType": "strategy" if path.name == "Document_Review_Strategy_CEP.xlsx" else "checklist",
            "process": mapping["process"],
            "relatedProcesses": mapping.get("relatedProcesses", []),
            "recordCount": 0,
        })
    return manifest


def review_checklist_entries(path: Path, manifest_item: dict[str, object]) -> list[dict[str, object]]:
    mapping = mapped_process(path.name)
    process = str(mapping["process"])
    related_processes = list(mapping.get("relatedProcesses", []))
    workbook = load_workbook(path, read_only=True, data_only=True)
    selected: tuple[object, object, int, dict[str, int]] | None = None
    rows_by_sheet: dict[str, list[tuple[object, ...]]] = {}
    for sheet in workbook.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        detected = header_row(rows)
        if detected is not None:
            selected = (sheet, rows, detected[0], detected[1])
            break
        rows_by_sheet[sheet.title] = rows
    if selected is None:
        return []
    sheet, rows, first_data_row, columns = selected
    category_column = columns["category"]
    number_column = columns["number"]
    contents_column = columns["contents"]
    work_products_column = columns["workProducts"]
    current_task = sheet.title
    entries: list[dict[str, object]] = []
    source_prefix = slug(path.stem)
    for row_number, row in enumerate(rows[first_data_row:], start=first_data_row + 1):
        question = text(row[contents_column] if contents_column < len(row) else "")
        number = text(row[number_column] if number_column < len(row) else "")
        category = text(row[category_column] if category_column < len(row) else "")
        if not question or question.lower() in {"contents", "questions"}:
            continue
        if not re.fullmatch(r"\d+(?:\.\d+)?", number):
            continue
        if category:
            current_task = category
        work_product = text(row[work_products_column] if work_products_column >= 0 and work_products_column < len(row) else "")
        entry: dict[str, object] = {
            "id": f"CHK-{source_prefix}-R{row_number:04d}",
            "process": process,
            "task": current_task,
            "question": question,
            "workProduct": work_product or expected_for(process),
            "sourceDocument": path.name,
            "sourcePath": str(manifest_item["sourcePath"]),
            "sourceGroup": str(manifest_item["sourceGroup"]),
            "sourceSheet": sheet.title,
            "sourceRow": row_number,
            "recordType": "checklist",
            "findingTrigger": f"未能提供可定位的项目级证据以回答：{question}",
            "expectedEvidence": expected_for(process),
            "closureEvidence": closure_for(process),
            "evidenceRole": "direct for the target process; support-process links are corroborating",
            "candidateOnly": True,
        }
        if related_processes:
            entry["relatedProcesses"] = related_processes
        entries.append(entry)
    return entries


def strategy_entries(path: Path, manifest_item: dict[str, object]) -> list[dict[str, object]]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook["Doc Review & Approval"] if "Doc Review & Approval" in workbook.sheetnames else workbook.worksheets[0]
    rows = list(sheet.iter_rows(values_only=True))
    entries: list[dict[str, object]] = []
    for row_number, row in enumerate(rows[2:], start=3):
        values = [text(value) for value in row]
        if not any(values):
            continue
        if len(values) >= 9 and re.fullmatch(r"\d+", values[0]):
            document_name, phase, owner, reviewer, approver, how, rules, status = values[1:9]
            mapping = dict(STRATEGY_PROCESS_MAP.get(document_name.lower(), {"process": "SUP.1"}))
            question = f"Document review strategy: {document_name}"
            entry: dict[str, object] = {
                "id": f"STRATEGY-{slug(document_name)}-R{row_number:04d}",
                "process": mapping["process"],
                "task": "Document review and approval strategy",
                "question": question,
                "workProduct": document_name or "Controlled document review strategy",
                "sourceDocument": path.name,
                "sourcePath": str(manifest_item["sourcePath"]),
                "sourceGroup": str(manifest_item["sourceGroup"]),
                "sourceSheet": sheet.title,
                "sourceRow": row_number,
                "recordType": "strategy",
                "strategyDocumentName": document_name,
                "phase": phase,
                "documentOwner": owner,
                "reviewer": reviewer,
                "approver": approver,
                "workflow": how,
                "reviewRules": rules,
                "strategyStatus": status,
                "findingTrigger": f"文档 {document_name} 缺少可定位的评审/批准流程证据",
                "expectedEvidence": expected_for(str(mapping["process"])),
                "closureEvidence": closure_for(str(mapping["process"])),
                "evidenceRole": "corroborating strategy definition; execution evidence remains required",
                "candidateOnly": True,
            }
            if mapping.get("relatedProcesses"):
                entry["relatedProcesses"] = list(mapping["relatedProcesses"])
            entries.append(entry)
            continue
        if len(values) >= 2 and values[0].lower().startswith(("document review", "document approval")):
            continue
        question = next((value for value in values if value), "")
        if not question or not re.match(r"^\d+\.", question):
            continue
        mapping = {"process": "SUP.1"}
        entry = {
            "id": f"STRATEGY-{slug(path.stem)}-R{row_number:04d}",
            "process": mapping["process"],
            "task": "Document review and approval strategy checklist",
            "question": question,
            "workProduct": "Document review and approval strategy",
            "sourceDocument": path.name,
            "sourcePath": str(manifest_item["sourcePath"]),
            "sourceGroup": str(manifest_item["sourceGroup"]),
            "sourceSheet": sheet.title,
            "sourceRow": row_number,
            "recordType": "strategy",
            "findingTrigger": f"文档评审策略条目缺少可定位的执行证据：{question}",
            "expectedEvidence": expected_for("SUP.1"),
            "closureEvidence": closure_for("SUP.1"),
            "evidenceRole": "corroborating strategy definition; execution evidence remains required",
            "candidateOnly": True,
        }
        entries.append(entry)
    return entries


def text(value: object) -> str:
    return " ".join(str(value or "").replace("\n", " ").split())


def checklist_entries() -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for path in sorted((SOURCE_ROOT / "Process Checklist Templates").glob("*.xlsx")):
        process = PROCESS_MAP.get(path.name)
        if not process:
            continue
        source_path = path.relative_to(SOURCE_ROOT).as_posix()
        source_group = source_path.split("/", 1)[0] if "/" in source_path else ""
        workbook = load_workbook(path, read_only=True, data_only=True)
        sheet = next((sheet for sheet in workbook.worksheets if "Checklist" in sheet.title or "Delivery" in sheet.title), None)
        if sheet is None:
            continue
        current_task = ""
        sequence = 0
        for row_number, row in enumerate(sheet.iter_rows(min_row=3, values_only=True), start=3):
            number = text(row[1] if len(row) > 1 else "")
            task_cell = text(row[2] if len(row) > 2 else "")
            question = text(row[3] if len(row) > 3 else "")
            work_product = text(row[4] if len(row) > 4 else "")
            if number.lower() == "tasks" or question.lower() == "questions":
                continue
            if task_cell and not question:
                if number and number.isdigit():
                    question = task_cell
                    task = current_task or sheet.title
                else:
                    current_task = task_cell
                    continue
            else:
                task = task_cell or current_task or sheet.title
            if not question or question.lower() in {"questions", "work products"}:
                continue
            if task == question and current_task:
                task = current_task
            sequence += 1
            entries.append({
                "id": f"{process.replace('.', '')}-QA-{sequence:03d}",
                "process": process,
                "task": task,
                "question": question,
                "workProduct": work_product or EXPECTED[process],
                "sourceDocument": path.name,
                "sourcePath": source_path,
                "sourceGroup": source_group,
                "sourceSheet": sheet.title,
                "sourceRow": row_number,
                "recordType": "checklist",
                "findingTrigger": f"未能提供可定位的项目级证据以回答：{question}",
                "expectedEvidence": EXPECTED[process],
                "closureEvidence": CLOSURE[process],
                "evidenceRole": "direct for the target process; support-process links are corroborating",
                "candidateOnly": True,
            })
    return entries


def qa_report_fields() -> list[dict[str, object]]:
    fields = [
        ("Review Status", "每个抽样客户需求的评审状态和结论"),
        ("Start Review Date", "QA 评审开始日期和版本"),
        ("Review Author", "QA 评审人及独立性"),
        ("Review workflow", "WI-ASP-0022 QA 工作流或等效受控流程"),
        ("SYS.1 Customer Document Reference (Helix document ID)", "受控的客户需求/Helix 文档引用"),
        ("Focus", "随机抽样比例和抽样依据"),
        ("Customer ID", "客户需求唯一标识"),
        ("HELIX CUS#", "工具原生需求编号或链接"),
    ]
    return [{
        "id": f"SUP1-QA-{index:03d}",
        "process": "SUP.1",
        "task": "QA report control and sampling",
        "question": question,
        "workProduct": expected,
        "sourceDocument": "SUP.1_xProjectx_QA_Report_xYYYYMMx.xlsx",
        "sourcePath": "SUP.1_xProjectx_QA_Report_xYYYYMMx.xlsx",
        "sourceGroup": "",
        "sourceSheet": "Main tab",
        "sourceRow": index + 3,
        "recordType": "qa-report-field",
        "findingTrigger": f"QA 报告未填写或无法定位字段：{question}",
        "expectedEvidence": expected,
        "closureEvidence": CLOSURE["SUP.1"],
        "evidenceRole": "direct for QA execution when populated and independently reviewable",
        "candidateOnly": True,
    } for index, (question, expected) in enumerate(fields, start=1)]


def main() -> None:
    manifest = source_manifest()
    checklist_source_entries: list[dict[str, object]] = []
    for manifest_item in manifest:
        source_path = CHECKLIST_ROOT / str(manifest_item["sourcePath"])
        if manifest_item["recordType"] == "strategy":
            checklist_source_entries.extend(strategy_entries(source_path, manifest_item))
        else:
            checklist_source_entries.extend(review_checklist_entries(source_path, manifest_item))

    # Preserve the original SUP.1 reference templates and add the supplied
    # project-review checklists as separately traceable candidate records.
    entries = qa_report_fields() + checklist_entries() + checklist_source_entries
    record_counts: dict[str, int] = {}
    for entry in checklist_source_entries:
        source_path = str(entry["sourcePath"])
        record_counts[source_path] = record_counts.get(source_path, 0) + 1
    for manifest_item in manifest:
        manifest_item["recordCount"] = record_counts.get(str(manifest_item["sourcePath"]), 0)

    source_files = sorted({
        (str(entry["sourceDocument"]), str(entry.get("sourcePath", "")))
        for entry in entries
        if entry.get("sourceDocument")
    })
    supplied_source_paths = [str(item["sourcePath"]) for item in manifest]
    supplied_source_files = [
        {"sourceDocument": str(item["sourceDocument"]), "sourcePath": str(item["sourcePath"])}
        for item in manifest
    ]
    legacy_source_files = [
        {"sourceDocument": source_document, "sourcePath": source_path}
        for source_document, source_path in source_files
        if source_path not in supplied_source_paths
    ]
    payload = {
        "schemaVersion": 1,
        "release": RELEASE_VERSION,
        "sourceBoundary": (
            "Local SUP.1 reference templates plus the supplied "
            "01_Checklist XLSX files (relative source paths only); "
            "no external Feishu/Jira data"
        ),
        "aiBoundary": "AI output is a candidate finding. Formal finding, rating, closure and baseline decision require assessor confirmation.",
        "closedLoop": ["SUP.1", "SUP.9", "SUP.10", "SUP.8"],
        "entryCount": len(entries),
        "processes": sorted({entry["process"] for entry in entries}),
        "sourceManifest": manifest,
        "sourceFiles": supplied_source_files,
        "sourcePaths": supplied_source_paths,
        "legacySourceFiles": legacy_source_files,
        "entries": entries,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("globalThis.AUDITFLOW_SUP_QA_CHECKLIST_CATALOG = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "entryCount": len(entries), "processes": sorted({entry["process"] for entry in entries})}, ensure_ascii=False))


if __name__ == "__main__":
    main()
