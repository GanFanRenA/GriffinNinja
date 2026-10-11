python3 -m http.server 8080

如果你是AI,在有不知道的代码或者代码有空缺，不要猜代码，告诉我这段代码的位置，我会将其提供给你。

#summon 100 test#
DO $$
DECLARE
  v_event_id uuid;
  v_college_ids uuid[];
  v_college_id uuid;
  v_i integer;
  v_email text;
  v_name text;
  v_college_idx integer;
  v_inserted integer := 0;
BEGIN
  SELECT id INTO v_event_id
  FROM public.events
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE NOTICE '没有事件，请先创建 events 记录';
    RETURN;
  END IF;

  SELECT array_agg(id ORDER BY
    CASE name
      WHEN 'Red'    THEN 1
      WHEN 'Yellow' THEN 2
      WHEN 'Blue'   THEN 3
      WHEN 'Green'  THEN 4
      ELSE 5
    END, name)
  INTO v_college_ids
  FROM public.colleges;

  IF array_length(v_college_ids, 1) < 4 THEN
    RAISE NOTICE '学院不足 4 个';
    RETURN;
  END IF;

  FOR v_i IN 1..100 LOOP
    v_email := 'test' || lpad(v_i::text, 3, '0') || '@bjsmicschool.com';
    v_name  := 'Test' || lpad(v_i::text, 3, '0');
    v_college_idx := ((v_i - 1) / 25) + 1;
    v_college_id  := v_college_ids[v_college_idx];

    IF EXISTS (SELECT 1 FROM public.participants WHERE email = v_email) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.participants (
      event_id, email, name, college_id, status, is_confirmed
    ) VALUES (
      v_event_id, v_email, v_name, v_college_id, 'alive', true
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RAISE NOTICE '已插入 % 个测试角色', v_inserted;
END $$;

# delete 100 test#
DO $$
DECLARE
  v_ids uuid[];
  v_deleted integer := 0;
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM public.participants
  WHERE email ~ '^test[0-9]{3}@bjsmicschool\.com$';

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RAISE NOTICE '没有测试角色';
    RETURN;
  END IF;

  -- 清掉指向测试角色的引用
  UPDATE public.participants
  SET current_target_id = NULL,
      eliminated_by_id  = NULL,
      updated_at        = now()
  WHERE current_target_id = ANY(v_ids)
     OR eliminated_by_id  = ANY(v_ids);

  -- 删除关联记录
  DELETE FROM public.eliminations
  WHERE hunter_id = ANY(v_ids)
     OR target_id = ANY(v_ids);

  DELETE FROM public.reports
  WHERE reporter_id = ANY(v_ids)
     OR target_id   = ANY(v_ids);

  -- 删除测试参与者
  DELETE FROM public.participants WHERE id = ANY(v_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE '已删除 % 个测试角色', v_deleted;
END $$;