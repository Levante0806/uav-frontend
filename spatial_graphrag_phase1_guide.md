# Spatial GraphRAG 阶段一：建立空间知识图谱详细指导

构建物理世界的空间知识图谱是整个项目的基础。下面我将针对这四个小步骤，为你提供从环境配置到代码实施的“保姆级”指导。

## 1. 数据源获取：基于 OSMnx 获取粤海街道数据

`OSMnx` 是一个强大的 Python 库，用于从 OpenStreetMap (OSM) 下载地理空间数据。

### 操作步骤
1.  **安装必要依赖**：
    在你的 Python 环境（比如您的 Agent 环境下）安装这些库。
    ```bash
    pip install osmnx networkx geopandas shapely
    ```
2.  **获取数据代码实战**：
    我们需要提取“粤海街道”的路网和建筑物轮廓。由于国内行政区划在 OSM 上可能不够精细，我们也可以通过给定一个“中心坐标+半径”的方式获取。
    ```python
    import osmnx as ox

    # 1. 设置我们感兴趣的区域（可以通过地名，或者中心坐标+半径）
    place_name = "Yuehai Subdistrict, Nanshan, Shenzhen, Guangdong, China"
    
    # 获取路网 (Network) - 以获取所有的可行驶道路为例
    # 这会返回一个 NetworkX 的 MultiDiGraph 对象
    G = ox.graph_from_place(place_name, network_type='all')
    
    # 获取建筑物轮廓 (Geometries)
    # tags={"building": True} 会把区域内所有地图上标记的建筑物多边形抓下来
    buildings = ox.geometries_from_place(place_name, tags={"building": True})

    print(f"提取到了 {len(G.nodes)} 个路网节点，{len(buildings)} 个建筑物实体。")
    ```
    > [!TIP]
    > 如果 `graph_from_place` 因为 OSM 地名解析问题找不到“粤海街道”，可以通过指定粤海街道中心的经纬度和一个 2000 米的半径来获取：`G = ox.graph_from_point((22.5333, 113.9304), dist=2000, network_type='all')`。

## 2. 提取节点与边，构建自定义图结构

通过上述操作，我们拿到了原始 GIS 数据，但我们需要将其转化为符合我们无人机业务场景的 Graph。

### 操作步骤
1.  **定义实体（Node）**：
    *   **路口节点**：直接使用我们刚才提取出来的 `G` 中的 nodes。
    *   **建筑物节点**：提取 `buildings` 的中心点（Centroid）作为图节点。
2.  **定义关系（Edge）**：
    *   **路与路相连**：物理街道连接。
    *   **建筑物到路的连接**：无人机可能需要从建筑起飞前往道路上方，我们要找出每个建筑最近的路口。

```python
import networkx as nx
from shapely.geometry import Point

# 初始化我们的无人机空间知识图谱
drone_graph = nx.Graph()

# ---- 处理路口节点 ----
for node_id, data in G.nodes(data=True):
    # 将路网节点加入自定义图谱
    drone_graph.add_node(
        f"road_{node_id}", 
        type="road",
        lon=data['x'], # 必然是 WGS84 经度
        lat=data['y'], # 必然是 WGS84 纬度
        name=f"Road Node {node_id}"
    )

# 添加路网本身的边
for u, v, data in G.edges(data=True):
    drone_graph.add_edge(f"road_{u}", f"road_{v}", type="street", length=data.get('length', 0))

# ---- 处理建筑物节点 ----
# 遍历所有的建筑物
for idx, building in buildings.iterrows():
    # 因为有些实体可能是点或线，我们只关心 Polygon（多边形）
    if building.geometry.geom_type in ['Polygon', 'MultiPolygon']:
        centroid = building.geometry.centroid # 获取建筑物中心坐标
        building_id = f"building_{idx}"
        
        # 将建筑物作为节点加入图谱
        drone_graph.add_node(
            building_id,
            type="building",
            lon=centroid.x,
            lat=centroid.y,
            name=building.get('name', 'Unknown Building'), # OSM上的建筑名（如果有）
            levels=building.get('building:levels', 1),     # 楼层高度（如果有）
            geometry=building.geometry.wkt                 # 存储几何多边形用于后续空间校验
        )
        
        # 建立建筑物与路网的空间拓扑连接！
        # 找到距离这栋楼最近的路口节点
        nearest_node = ox.distance.nearest_nodes(G, X=centroid.x, Y=centroid.y)
        # 用一条 "access" 边把楼和路连接起来
        drone_graph.add_edge(building_id, f"road_{nearest_node}", type="access")
```

## 3. 坐标系统一与清洗

如果您只使用 OSMnx，那么拿到的坐标其实已经是纯正的 **WGS84**，这与基于 Cesium 的无人机前端是可以完美匹配的。但是，如果在实际开发中混入了一些高德/百度的 API 点位，您就需要在这里做一步清洗。

### 操作步骤
1.  **准备转换工具**：
    如果您有外部的 GCJ-02 (高德/腾讯) 坐标，请安装 `coord-convert`。
    ```bash
    pip install coord-convert
    ```
2.  **在循环入库前做校验**：
    ```python
    import coord_convert.utils as coord_utils
    
    def ensure_wgs84(lon, lat, source_type="WGS84"):
        if source_type == "GCJ02":
            return coord_utils.gcj02_to_wgs84(lon, lat)
        elif source_type == "BD09":
            return coord_utils.bd09_to_wgs84(lon, lat)
        return lon, lat # 已经是 WGS84 则原样返回
    ```
    > [!IMPORTANT]
    > 严把数据入库侧的坐标系。必须保证图谱中的所有 `lon`, `lat` 属性完全基于并且仅仅基于 WGS84。后续前端 Cesium 只管渲染 WGS84，不需要在前端做复杂的转换。

## 4. 图数据库存储：内存 NetworkX 与导出

在论文验证和系统初期（粤海街道范围大概几万个节点），完全没有必要为了这个引入笨重的 Neo4j，直接用 Python 的 `NetworkX` 处理即可。我们只需将其持久化为 JSON 提供给系统使用。

### 操作步骤
1.  **导出为 JSON 供大模型和前端使用**：
    ```python
    import json
    from networkx.readwrite import json_graph

    # 把图对象转为标准的 node-link 字典格式
    data = json_graph.node_link_data(drone_graph)
    
    # 写入 JSON 文件
    with open('yuehai_spatial_graph.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    ```

2.  **如何在 Agent 中使用它进行校验？（简单预览）**
    以后无论是您的模型还是逻辑，只要读取这个 JSON 并恢复成图对象，查询就会异常简单。比如我们要进行无人机起飞前的环境判断：
    ```python
    # 重新加载图谱
    with open('yuehai_spatial_graph.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    loaded_graph = json_graph.node_link_graph(data)

    # 寻找某个腾讯大厦节点的周围 1 跳关系（与之相邻的路和起降点）
    neighbors = list(loaded_graph.neighbors("building_12345"))
    print("这栋楼附近的路口有：", neighbors)
    ```

### 总结我们现在的成果
完成这步后，您将拥有一个包含着真实且带有边界和属性的 **"粤海街道微观宇宙 JSON 文件"**，这取代了原本前端零散或写死的一批死坐标。您的无人机将第一次真正“认识”这个坐标的拓扑连接。
