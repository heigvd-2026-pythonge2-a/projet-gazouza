"""Group pins into SPICE nodes and name them (docs/format-schema.md, section 7).

Wires say explicitly what they are attached to, so this is pure graph work, no geometry:
every wire merges its two attached ends ("union-find"), then each group gets a name.
"""

from collections.abc import Hashable
from dataclasses import dataclass, field

from app.models import Component, FreeEnd, JunctionEnd, PinEnd, Schematic, WireEnd
from app.netlist.library import ComponentType

# A point a wire can attach to: ("pin", component id, pin name) or ("junction", junction id).
Point = tuple[str, ...]


class UnionFind:
    """Disjoint sets: `union(a, b)` puts a and b in the same group, `find(a)` names the group."""

    def __init__(self) -> None:
        self.parent: dict[Hashable, Hashable] = {}

    def find(self, item: Hashable) -> Hashable:
        self.parent.setdefault(item, item)
        root = item
        while self.parent[root] != root:
            root = self.parent[root]
        # Path compression: point every visited item straight to the root.
        while self.parent[item] != root:
            self.parent[item], item = root, self.parent[item]
        return root

    def union(self, a: Hashable, b: Hashable) -> None:
        self.parent[self.find(a)] = self.find(b)


def end_point(end: WireEnd) -> Point | None:
    """The attachment point of a wire end, or None for a free (dangling) end."""
    if isinstance(end, PinEnd):
        return ("pin", end.comp, end.pin)
    if isinstance(end, JunctionEnd):
        return ("junction", end.junction)
    assert isinstance(end, FreeEnd)
    return None


@dataclass
class Nodes:
    """Result of the connectivity step."""

    pin_node: dict[tuple[str, str], str] = field(default_factory=dict)  # (comp id, pin) -> node
    nets: dict[str, list[str]] = field(default_factory=dict)  # node -> wire ids
    connected: set[Point] = field(default_factory=set)  # points touched by at least one wire
    label_conflicts: list[list[str]] = field(default_factory=list)  # label ids, per node
    labels_on_ground: list[str] = field(default_factory=list)  # label ids


def build_nodes(schematic: Schematic, library: dict[str, ComponentType]) -> Nodes:
    """Merge the points joined by wires and by same-name labels, then name every node.

    Assumes the schematic passed the checks (known types, existing endpoints, valid labels).
    """
    groups = UnionFind()
    nodes = Nodes()

    # 1. Every wire merges its attached ends. A wire with one free end still belongs to the
    #    node of its other end.
    for wire in schematic.wires:
        points = [p for p in (end_point(wire.from_), end_point(wire.to)) if p is not None]
        nodes.connected.update(points)
        for point in points:
            groups.find(point)
        if len(points) == 2:
            groups.union(*points)

    # 2. Labels with the same name are the same node, even without a wire between them
    #    (SPICE ignores case).
    label_points: dict[str, Point] = {}
    for comp in schematic.components:
        if comp.type == "label" and comp.params.get("net", "").strip():
            point = ("pin", comp.id, "1")
            key = comp.params["net"].strip().lower()
            if key in label_points:
                groups.union(point, label_points[key])
            label_points[key] = point

    # 3. What each group touches: a ground, labels.
    root_is_ground: set[Hashable] = set()
    root_labels: dict[Hashable, list[Component]] = {}
    for comp in schematic.components:
        root = groups.find(("pin", comp.id, "1"))
        if comp.type == "ground":
            root_is_ground.add(root)
        elif comp.type == "label" and comp.params.get("net", "").strip():
            root_labels.setdefault(root, []).append(comp)

    root_label: dict[Hashable, str] = {}
    for root, labels in root_labels.items():
        root_label[root] = labels[0].params["net"].strip()
        if len({label.params["net"].strip().lower() for label in labels}) > 1:
            nodes.label_conflicts.append([label.id for label in labels])
        if root in root_is_ground:
            nodes.labels_on_ground.extend(label.id for label in labels)

    # 4. Name the groups: ground -> "0", label -> its name, otherwise n1, n2... in the order
    #    of the components, then of their pins in the library.
    root_name: dict[Hashable, str] = {}
    counter = 0
    for comp in schematic.components:
        for pin in library[comp.type].pins:
            root = groups.find(("pin", comp.id, pin.name))
            if root not in root_name:
                if root in root_is_ground:
                    root_name[root] = "0"
                elif root in root_label:
                    root_name[root] = root_label[root]
                else:
                    counter += 1
                    root_name[root] = f"n{counter}"
            nodes.pin_node[(comp.id, pin.name)] = root_name[root]

    # 5. Node -> wires, in the order of the wires (used by the voltage probe).
    for wire in schematic.wires:
        point = end_point(wire.from_) or end_point(wire.to)
        if point is None:
            continue  # both ends free: the wire belongs to no node
        name = root_name.get(groups.find(point))
        if name is not None:
            nodes.nets.setdefault(name, []).append(wire.id)
    return nodes


def touches(nodes: Nodes, comp: Component, pin: str) -> bool:
    """True if at least one wire is attached to this pin."""
    return ("pin", comp.id, pin) in nodes.connected
