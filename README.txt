const { supabase } = await import('/js/supabase.js');

// 1. 检查登录
const { data: { session } } = await supabase.auth.getSession();
console.log('登录邮箱:', session?.user?.email);

// 2. 检查管理员
const { data: isAdmin } = await supabase.rpc('is_admin');
console.log('是否管理员:', isAdmin);

// 3. 生成代码和环
const { data: gen, error: genErr } = await supabase.rpc('admin_generate_codes_and_ring');
console.log('生成结果:', gen, genErr);

// 4. 启动活动
const { data: start, error: startErr } = await supabase.rpc('admin_set_event_status', {
  p_status: 'active'
});
console.log('启动结果:', start, startErr);

// 5. 查看公共主页数据
const { data: home } = await supabase.rpc('get_public_home');
console.log('公共主页:', home);

python3 -m http.server 8080