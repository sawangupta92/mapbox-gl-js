varying float v_radius;
varying vec2 v_extrude;
varying float v_perspective_ratio;
varying float v_collision;

void main() {

    float alpha = 0.25 * min(v_perspective_ratio, 1.0);
    float stroke_radius = 0.85 * max(v_perspective_ratio, 1.0);

    vec4 test = gl_FragCoord;

    float distance_to_center = length(v_extrude) ;
    float distance_to_edge = abs(distance_to_center - v_radius );
    float opacity_t = smoothstep(-stroke_radius, 0.0, -distance_to_edge);

    vec3 color = mix(vec3(0, 0, 1), vec3(1, 0, 0), v_collision);

    gl_FragColor = vec4(color, 1.0) * alpha * pow(opacity_t, 1.4);
}
