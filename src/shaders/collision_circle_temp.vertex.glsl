attribute vec2 a_idx;

uniform mat4 u_matrix;
uniform mat4 u_invMatrix;
uniform vec2 u_viewport_size;
uniform float u_camera_to_center_distance;

uniform vec4 u_quads[64];

varying float v_radius;
varying vec2 v_extrude;
varying float v_perspective_ratio;
varying float v_collision;

void main() {  
    float vertexIdx = mod(a_idx.x, 4.0);

    // Deduce vertex position and quad index from vertex index
    vec4 quadVec = u_quads[int(floor(a_idx.x / 4.0))];

    // 100 = hard-coded padding used in collision logic
    vec2 quadCenterPos = quadVec.xy - vec2(100.0);
    float radius = quadVec.z;
    float collision = quadVec.w;

    vec2 quadVertexOffset = vec2(
        mix(-1.0, 1.0, float(vertexIdx >= 2.0)),
        mix(-1.0, 1.0, float(vertexIdx >= 1.0 && vertexIdx <= 2.0)));

    vec2 quadVertexExtent = quadVertexOffset * radius;

    //vec4 clipPos = u_matrix * vec4(quadCenterPos.xy, quadCenterPos.z / 16384.0, 1.0);

    // Project center position to tile space to reconstruct the depth information
    vec4 rayStart = u_invMatrix * vec4(quadCenterPos, -1.0, 1.0);
    vec4 rayEnd   = u_invMatrix * vec4(quadCenterPos,  1.0, 1.0);

    rayStart.xyz /= rayStart.w;
    rayEnd.xyz   /= rayEnd.w;

    float t = (0.0 - rayStart.z) / (rayEnd.z - rayStart.z);

    vec3 tilePos = mix(rayStart.xyz, rayEnd.xyz, t);
    vec4 clipPos = u_matrix * vec4(tilePos, 1.0);

    float padding_factor = 1.2;
    v_radius = radius;
    v_extrude = quadVertexExtent * padding_factor;

    highp float camera_to_anchor_distance = clipPos.w;
    highp float collision_perspective_ratio = clamp(
        0.5 + 0.5 * (u_camera_to_center_distance / camera_to_anchor_distance),
        0.0, // Prevents oversized near-field circles in pitched/overzoomed tiles
        4.0);

    v_perspective_ratio = collision_perspective_ratio;
    v_collision = collision;
    gl_Position = vec4(clipPos.xyz / clipPos.w, 1.0) + vec4(quadVertexExtent * padding_factor / u_viewport_size * 2.0, 0.0, 0.0);




    //vec4 rayStart = u_toWorld * vec4(clipPos.xy / clipPos.w, -1.0, 1.0);
    //vec4 rayEnd   = u_toWorld * vec4(clipPos.xy / clipPos.w,  1.0, 1.0);
//
    //rayStart.xyz /= rayStart.w;
    //rayEnd.xyz   /= rayEnd.w;
//
    //float t = (0.0 - rayStart.z) / (rayEnd.z - rayStart.z);
    //vec3 tilePos = mix(rayStart.xyz, rayEnd.xyz, t);
//
    //float padding_factor = 1.2;
    //v_radius = abs(a_extent.y);
    //v_extrude = a_extent * padding_factor;
//
    //clipPos = u_fromWorld * vec4(tilePos, 1.0);
//
    //highp float camera_to_anchor_distance = clipPos.w;
    //highp float collision_perspective_ratio = clamp(
    //    0.5 + 0.5 * (u_camera_to_center_distance / camera_to_anchor_distance),
    //    0.0, // Prevents oversized near-field circles in pitched/overzoomed tiles
    //    4.0);
//
    //v_perspective_ratio = collision_perspective_ratio;
    //v_collision = a_reserved.x;
    //gl_Position = vec4(clipPos.xyz / clipPos.w, 1.0) + vec4(a_extent * padding_factor / u_viewport_size * 2.0, 0.0, 0.0);
}
