"""Run: cd scripts && python3 -m unittest test_lucid_vsdx_to_diagram"""
import importlib.util
import io
import json
import pathlib
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("conv", pathlib.Path(__file__).with_name("lucid-vsdx-to-diagram.py"))
conv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conv)

NS = 'xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def block(sid, name, x, y, w, h, text, fill="#ffffff"):
    return (f'<Shape ID="{sid}" Name="com.lucidchart.{name}"><Cell N="PinX" V="{x}"/><Cell N="PinY" V="{y}"/>'
            f'<Cell N="Width" V="{w}"/><Cell N="Height" V="{h}"/><Cell N="FillForegnd" V="{fill}"/><Text>{text}</Text></Shape>')


def line(sid, label, begin_arrow, end_arrow):
    return (f'<Shape ID="{sid}" Name="com.lucidchart.Line"><Cell N="BeginArrow" V="{begin_arrow}"/>'
            f'<Cell N="EndArrow" V="{end_arrow}"/><Text>{label}</Text></Shape>')


def connect(line_id, part, to):
    return f'<Connect FromSheet="{line_id}" FromPart="{part}" ToSheet="{to}" ToPart="100"/>'


# Visio y points up. A (left) -> B (right, red) -> C (below B); D is a far-away box; line 13 has an arrow at its start.
PAGE = f"""<PageContents {NS}><Shapes>
{block(1, "ProcessBlock", 1, -1, 1, 0.5, "A", "#cfe2ff")}
{block(2, "ProcessBlock", 4, -1, 1, 0.5, "B", "#e8706a")}
{block(3, "DecisionBlock", 4, -3, 1, 0.5, "C")}
{block(4, "ProcessBlock", 40, -30, 1, 0.5, "Far away")}
{line(11, "go", 0, 4)}
{line(12, "down", 0, 4)}
{line(13, "reverse", 4, 0)}
</Shapes><Connects>
{connect(11, 9, 1)}{connect(11, 12, 2)}{connect(12, 9, 2)}{connect(12, 12, 3)}{connect(13, 9, 3)}{connect(13, 12, 1)}
</Connects></PageContents>"""


def vsdx_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("visio/pages/pages.xml", f'<Pages {NS}><Page ID="0" Name="My Page"><Rel r:id="rId1"/></Page></Pages>')
        zf.writestr("visio/pages/_rels/pages.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="page1.xml"/></Relationships>')
        zf.writestr("visio/pages/page1.xml", PAGE)
    return buf.getvalue()


class ConvertTest(unittest.TestCase):
    def test_boxes_arrows_and_layout(self):
        d, warnings = conv.convert_page(PAGE)
        by_id = {n["id"]: n for n in d["nodes"]}
        self.assertEqual(warnings, [])
        self.assertEqual(by_id["n1"]["data"], {"label": "A", "kind": "blue"})
        self.assertEqual(by_id["n2"]["data"]["kind"], "red")      # fill snaps to the page's red
        self.assertEqual(by_id["n3"]["data"]["kind"], "pink")     # DecisionBlock -> diamond
        self.assertLess(by_id["n1"]["position"]["x"], by_id["n2"]["position"]["x"])
        self.assertLess(by_id["n2"]["position"]["y"], by_id["n3"]["position"]["y"])  # y flipped: C is lower on screen
        e = {x["id"]: x for x in d["edges"]}
        self.assertEqual((e["e11"]["source"], e["e11"]["sourceHandle"], e["e11"]["targetHandle"]), ("n1", "r", "l"))
        self.assertEqual((e["e12"]["sourceHandle"], e["e12"]["targetHandle"]), ("b", "t"))
        # an arrowhead only at the line's start means the arrow points the other way: source/target swap
        self.assertEqual((e["e13"]["source"], e["e13"]["target"]), ("n1", "n3"))
        self.assertEqual(e["e11"]["label"], "go")

    def test_component_keeps_neighbourhood_only(self):
        d, _ = conv.convert_page(PAGE, component="B")
        self.assertEqual({n["data"]["label"] for n in d["nodes"]}, {"A", "B", "C"})
        self.assertEqual(len(d["edges"]), 3)

    def test_file_round_trip_and_page_lookup(self):
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".vsdx") as f, tempfile.NamedTemporaryFile(suffix=".json") as out:
            f.write(vsdx_bytes()); f.flush()
            self.assertEqual(conv.main([f.name, "--page", "My Page", "-o", out.name]), 0)
            with open(out.name) as fh:
                self.assertEqual(len(json.load(fh)["nodes"]), 4)
            self.assertEqual(conv.main([f.name, "--page", "Nope"]), 2)


if __name__ == "__main__":
    unittest.main()
